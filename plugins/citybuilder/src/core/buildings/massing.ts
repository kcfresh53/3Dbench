import { addFacadeDetail } from './facade_detail';
import { buildTurbine } from './turbine';
import { buildTower, isTowerShape } from './towers';
import type { Vec2, Vec3 } from '../types';
import { Rng, dot3 } from '../math';
import type { BuildingModel, BuildingSpec, FacadeRow, FacadeRun, ModelPiece, PieceTag, RoofProp, Volume } from './types';
import { makeShape, rectangles, floorsAt } from './footprint';
import type { CellRect, FloorGrid } from './footprint';
import { tileRef } from './tiles';
import type { TileKind, TileRef } from './tiles';

const UP: Vec3 = [0, 1, 0];
export const FOUNDATION_DEPTH = 0.5;
export const PARAPET_HEIGHT = 0.55;
const FULL_UV: Vec2[] = [[0, 1], [1, 1], [1, 0], [0, 0]];
const TRI_UV: Vec2[] = [[0, 1], [1, 1], [0.5, 0]];

/** Height of the roof deck for a part of the building with this many floors. */
export function roofHeight(spec: BuildingSpec, floors: number): number {
	return floors <= 1 ? spec.groundHeight : spec.groundHeight + (floors - 1) * spec.floorHeight;
}

/** Vertical extent of one floor. */
export function floorSpan(spec: BuildingSpec, floor: number): { y0: number; height: number } {
	return floor === 0 ? { y0: 0, height: spec.groundHeight } : { y0: spec.groundHeight + (floor - 1) * spec.floorHeight, height: spec.floorHeight };
}

// ---- Facade runs ------------------------------------------------------------------------------

type Direction = 0 | 1 | 2 | 3; // front (-z), back (+z), right (+x), left (-x)
const DELTAS: Array<[number, number]> = [[0, -1], [0, 1], [1, 0], [-1, 0]];

interface Edge {
	dir: Direction;
	line: number;
	pos: number;
	low: number;
	high: number;
}

function collectEdges(grid: FloorGrid): Map<string, Edge[]> {
	const groups: Map<string, Edge[]> = new Map();
	for (let iz: number = 0; iz < grid.nz; iz++) {
		for (let ix: number = 0; ix < grid.nx; ix++) {
			const f: number = floorsAt(grid, ix, iz);
			if (f === 0) continue;
			for (let d: number = 0; d < 4; d++) {
				const nf: number = floorsAt(grid, ix + DELTAS[d][0], iz + DELTAS[d][1]);
				if (f <= nf) continue;
				const dir: Direction = d as Direction;
				const edge: Edge = { dir, line: dir < 2 ? iz : ix, pos: dir < 2 ? ix : iz, low: nf, high: f };
				const key: string = `${dir}|${edge.line}|${nf}|${f}`;
				const list: Edge[] | undefined = groups.get(key);
				if (list) list.push(edge);
				else groups.set(key, [edge]);
			}
		}
	}
	return groups;
}

interface RunGeometry {
	origin: Vec3;
	along: Vec3;
	normal: Vec3;
}

function runGeometry(dir: Direction, line: number, start: number, end: number, width: number, depth: number, bay: number): RunGeometry {
	const x0 = (i: number): number => -width / 2 + i * bay;
	const z0 = (i: number): number => -depth / 2 + i * bay;
	switch (dir) {
		case 0:
			return { origin: [x0(end) + bay, 0, z0(line)], along: [-1, 0, 0], normal: [0, 0, -1] };
		case 1:
			return { origin: [x0(start), 0, z0(line) + bay], along: [1, 0, 0], normal: [0, 0, 1] };
		case 2:
			return { origin: [x0(line) + bay, 0, z0(end) + bay], along: [0, 0, -1], normal: [1, 0, 0] };
		default:
			return { origin: [x0(line), 0, z0(start)], along: [0, 0, 1], normal: [-1, 0, 0] };
	}
}

interface TileContext {
	floor: number;
	low: number;
	bay: number;
	bays: number;
	front: boolean;
	mainFront: boolean;
	doorBay: number;
	rng: Rng;
}

function pick(spec: BuildingSpec, kind: TileKind): TileRef {
	return tileRef(kind, spec.palette);
}

/** Chooses the tile of one bay on one floor from the building's facade style. */
function pickTile(spec: BuildingSpec, c: TileContext): TileRef {
	const ground: boolean = c.floor === 0 && c.low === 0;
	const edge: boolean = c.bay === 0 || c.bay === c.bays - 1;
	switch (spec.style) {
		case 'house': {
			if (ground && c.mainFront && c.bay === c.doorBay) return pick(spec, 'door');
			if (!c.front && c.bays > 2 && edge && c.rng.chance(0.5)) return pick(spec, 'wall');
			return pick(spec, c.rng.chance(0.2) ? 'window_wide' : 'window');
		}
		case 'apartment': {
			if (ground && c.mainFront && c.bay === c.doorBay) return pick(spec, 'door');
			if (spec.balconies && c.front && !ground && c.bay % 2 === 1 && !edge) return pick(spec, 'balcony');
			return pick(spec, c.rng.chance(0.12) ? 'window_wide' : 'window');
		}
		case 'shop': {
			if (ground) {
				if (c.front) return pick(spec, c.mainFront && c.bay === c.doorBay ? 'shop_door' : 'shop_glass');
				return pick(spec, c.rng.chance(0.3) ? 'window' : 'brick');
			}
			return pick(spec, c.front || c.bay % 2 === 0 ? 'window' : 'wall');
		}
		case 'curtain': {
			if (ground && c.front) return pick(spec, c.mainFront && c.bay === c.doorBay ? 'shop_door' : 'shop_glass');
			return pick(spec, c.floor % 4 === 3 ? 'curtain_band' : 'curtain');
		}
		case 'industrial': {
			if (ground && c.front && c.bay % 3 === 1 && c.bays >= 3) return pick(spec, 'garage');
			if (ground) return pick(spec, 'panel');
			return pick(spec, 'panel_high');
		}
		default: {
			if (ground && c.mainFront && c.bay === c.doorBay) return pick(spec, 'door');
			return pick(spec, c.bays >= 2 && c.floor > 0 ? 'window_pair' : 'window_wide');
		}
	}
}

function buildRuns(spec: BuildingSpec, grid: FloorGrid, width: number, depth: number): FacadeRun[] {
	const runs: FacadeRun[] = [];
	const groups: Map<string, Edge[]> = collectEdges(grid);
	const keys: string[] = [...groups.keys()].sort();
	interface Pending {
		edge: Edge;
		start: number;
		end: number;
	}
	const pending: Pending[] = [];
	for (const key of keys) {
		const edges: Edge[] = (groups.get(key) as Edge[]).sort((a: Edge, b: Edge): number => a.pos - b.pos);
		let start: Edge = edges[0];
		let previous: Edge = edges[0];
		for (let i: number = 1; i <= edges.length; i++) {
			const e: Edge | undefined = edges[i];
			if (e && e.pos === previous.pos + 1) {
				previous = e;
				continue;
			}
			pending.push({ edge: start, start: start.pos, end: previous.pos });
			if (e) {
				start = e;
				previous = e;
			}
		}
	}
	// The street door goes on the widest ground-level front wall that touches the front boundary.
	let mainFront: Pending | null = null;
	for (const p of pending) {
		if (p.edge.dir === 0 && p.edge.low === 0 && (mainFront === null || p.end - p.start > mainFront.end - mainFront.start || (p.end - p.start === mainFront.end - mainFront.start && p.edge.line < mainFront.edge.line))) mainFront = p;
	}
	pending.forEach((p: Pending, index: number): void => {
		const { edge } = p;
		const bays: number = p.end - p.start + 1;
		const geo: RunGeometry = runGeometry(edge.dir, edge.line, p.start, p.end, width, depth, spec.bay);
		const rng: Rng = new Rng(spec.seed * 2654435761 + index * 40503 + 17);
		const isMain: boolean = mainFront === p;
		const rows: FacadeRow[] = [];
		if (edge.low === 0) rows.push({ y0: -FOUNDATION_DEPTH, height: FOUNDATION_DEPTH, tiles: new Array<TileRef>(bays).fill(pick(spec, 'plinth')) });
		for (let k: number = edge.low; k < edge.high; k++) {
			const span = floorSpan(spec, k);
			const tiles: TileRef[] = [];
			for (let b: number = 0; b < bays; b++) {
				tiles.push(
					pickTile(spec, { floor: k, low: edge.low, bay: b, bays, front: edge.dir === 0, mainFront: isMain, doorBay: Math.floor((bays - 1) / 2), rng }),
				);
			}
			rows.push({ y0: span.y0, height: span.height, tiles });
		}
		if (spec.roof === 'flat' && spec.parapet) {
			const top: number = roofHeight(spec, edge.high);
			rows.push({ y0: top, height: PARAPET_HEIGHT, tiles: new Array<TileRef>(bays).fill(pick(spec, 'trim')) });
		}
		runs.push({ id: index, origin: geo.origin, along: geo.along, normal: geo.normal, bays, bayWidth: spec.bay, rows, front: edge.dir === 0 });
	});
	return runs;
}

// ---- Pieces -----------------------------------------------------------------------------------

function normalOf(corners: Vec3[]): Vec3 {
	let x: number = 0;
	let y: number = 0;
	let z: number = 0;
	for (let i: number = 0; i < corners.length; i++) {
		const a: Vec3 = corners[i];
		const b: Vec3 = corners[(i + 1) % corners.length];
		x += (a[1] - b[1]) * (a[2] + b[2]);
		y += (a[2] - b[2]) * (a[0] + b[0]);
		z += (a[0] - b[0]) * (a[1] + b[1]);
	}
	return [x, y, z];
}

/** Flips a polygon so its normal agrees with `facing`. */
export function oriented(corners: Vec3[], uvs: Vec2[], facing: Vec3): { corners: Vec3[]; uvs: Vec2[] } {
	if (dot3(normalOf(corners), facing) >= 0) return { corners, uvs };
	return { corners: corners.slice().reverse(), uvs: uvs.slice().reverse() };
}

class PieceList {
	readonly pieces: ModelPiece[] = [];

	add(corners: Vec3[], tile: TileRef, tag: PieceTag, maxLod: 0 | 1 | 2, facing: Vec3): void {
		const uvs: Vec2[] = corners.length === 3 ? TRI_UV : FULL_UV;
		const o = oriented(corners, uvs, facing);
		this.pieces.push({ corners: o.corners, uvs: o.uvs, tile, tag, maxLod });
	}

	/** Five faces of a box standing on `base` (no bottom). */
	box(cx: number, base: number, cz: number, sx: number, sy: number, sz: number, tile: TileRef, maxLod: 0 | 1 | 2): void {
		const x0: number = cx - sx / 2;
		const x1: number = cx + sx / 2;
		const z0: number = cz - sz / 2;
		const z1: number = cz + sz / 2;
		const y1: number = base + sy;
		this.add([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], tile, 'prop', maxLod, UP);
		this.add([[x0, base, z0], [x1, base, z0], [x1, y1, z0], [x0, y1, z0]], tile, 'prop', maxLod, [0, 0, -1]);
		this.add([[x0, base, z1], [x1, base, z1], [x1, y1, z1], [x0, y1, z1]], tile, 'prop', maxLod, [0, 0, 1]);
		this.add([[x0, base, z0], [x0, base, z1], [x0, y1, z1], [x0, y1, z0]], tile, 'prop', maxLod, [-1, 0, 0]);
		this.add([[x1, base, z0], [x1, base, z1], [x1, y1, z1], [x1, y1, z0]], tile, 'prop', maxLod, [1, 0, 0]);
	}
}

const PROP_SIZES: Record<RoofProp, [number, number, number]> = {
	hvac: [1.8, 1.0, 1.2],
	tank: [1.7, 2.4, 1.7],
	vent: [0.6, 0.9, 0.6],
	antenna: [0.18, 5.5, 0.18],
	chimney: [1.1, 7, 1.1],
	spire: [2.2, 9, 2.2],
};

function roofTileFor(spec: BuildingSpec): TileKind {
	if (spec.roof === 'flat') return 'roof_flat';
	return spec.style === 'house' || spec.style === 'civic' ? 'roof_tile' : 'roof_metal';
}

/** True when any cell along a rectangle edge borders lower ground, so a parapet or gutter is needed there. */
function edgeExposed(grid: FloorGrid, r: CellRect, dir: Direction): boolean {
	const [dx, dz] = DELTAS[dir];
	for (let k: number = dir < 2 ? r.c0 : r.r0; k <= (dir < 2 ? r.c1 : r.r1); k++) {
		const ix: number = dir < 2 ? k : dir === 2 ? r.c1 : r.c0;
		const iz: number = dir < 2 ? (dir === 0 ? r.r0 : r.r1) : k;
		if (floorsAt(grid, ix + dx, iz + dz) < r.floors) return true;
	}
	return false;
}

function addRoofs(spec: BuildingSpec, grid: FloorGrid, rects: CellRect[], width: number, depth: number, list: PieceList): number {
	const roofTile: TileRef = pick(spec, roofTileFor(spec));
	const wall: TileRef = pick(spec, 'wall');
	const trim: TileRef = pick(spec, 'trim');
	const bay: number = spec.bay;
	let topMost: number = 0;
	const single: boolean = rects.length === 1;
	const kind = single ? spec.roof : 'flat';
	for (const r of rects) {
		const x0: number = -width / 2 + r.c0 * bay;
		const x1: number = -width / 2 + (r.c1 + 1) * bay;
		const z0: number = -depth / 2 + r.r0 * bay;
		const z1: number = -depth / 2 + (r.r1 + 1) * bay;
		const y: number = roofHeight(spec, r.floors);
		const xm: number = (x0 + x1) / 2;
		const zm: number = (z0 + z1) / 2;
		const spanX: number = x1 - x0;
		const spanZ: number = z1 - z0;
		const tan: number = Math.tan((spec.pitch * Math.PI) / 180);
		topMost = Math.max(topMost, y);
		if (kind === 'flat') {
			list.add([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], roofTile, 'roof', 2, UP);
			if (spec.parapet) {
				// Inner faces of the parapet so the rim reads as a wall from above.
				const top: number = y + PARAPET_HEIGHT;
				if (edgeExposed(grid, r, 0)) list.add([[x0, y, z0], [x1, y, z0], [x1, top, z0], [x0, top, z0]], trim, 'parapet', 0, [0, 0, 1]);
				if (edgeExposed(grid, r, 1)) list.add([[x0, y, z1], [x1, y, z1], [x1, top, z1], [x0, top, z1]], trim, 'parapet', 0, [0, 0, -1]);
				if (edgeExposed(grid, r, 2)) list.add([[x1, y, z0], [x1, y, z1], [x1, top, z1], [x1, top, z0]], trim, 'parapet', 0, [-1, 0, 0]);
				if (edgeExposed(grid, r, 3)) list.add([[x0, y, z0], [x0, y, z1], [x0, top, z1], [x0, top, z0]], trim, 'parapet', 0, [1, 0, 0]);
				topMost = Math.max(topMost, top);
			}
		} else if (kind === 'shed') {
			const rise: number = Math.min(2.6, spanZ * tan * 0.5);
			list.add([[x0, y, z0], [x1, y, z0], [x1, y + rise, z1], [x0, y + rise, z1]], roofTile, 'roof', 2, [0, 1, -0.3]);
			list.add([[x0, y, z1], [x1, y, z1], [x1, y + rise, z1], [x0, y + rise, z1]], wall, 'gable', 1, [0, 0, 1]);
			list.add([[x0, y, z0], [x0, y, z1], [x0, y + rise, z1]], wall, 'gable', 1, [-1, 0, 0]);
			list.add([[x1, y, z0], [x1, y, z1], [x1, y + rise, z1]], wall, 'gable', 1, [1, 0, 0]);
			topMost = Math.max(topMost, y + rise);
		} else if (kind === 'gable') {
			const alongX: boolean = spanX >= spanZ;
			const half: number = (alongX ? spanZ : spanX) / 2;
			const rise: number = half * tan;
			if (alongX) {
				list.add([[x0, y, z0], [x1, y, z0], [x1, y + rise, zm], [x0, y + rise, zm]], roofTile, 'roof', 2, [0, 1, -1]);
				list.add([[x0, y, z1], [x1, y, z1], [x1, y + rise, zm], [x0, y + rise, zm]], roofTile, 'roof', 2, [0, 1, 1]);
				list.add([[x0, y, z0], [x0, y, z1], [x0, y + rise, zm]], wall, 'gable', 1, [-1, 0, 0]);
				list.add([[x1, y, z0], [x1, y, z1], [x1, y + rise, zm]], wall, 'gable', 1, [1, 0, 0]);
			} else {
				list.add([[x0, y, z0], [x0, y, z1], [xm, y + rise, z1], [xm, y + rise, z0]], roofTile, 'roof', 2, [-1, 1, 0]);
				list.add([[x1, y, z0], [x1, y, z1], [xm, y + rise, z1], [xm, y + rise, z0]], roofTile, 'roof', 2, [1, 1, 0]);
				list.add([[x0, y, z0], [x1, y, z0], [xm, y + rise, z0]], wall, 'gable', 1, [0, 0, -1]);
				list.add([[x0, y, z1], [x1, y, z1], [xm, y + rise, z1]], wall, 'gable', 1, [0, 0, 1]);
			}
			topMost = Math.max(topMost, y + rise);
		} else {
			// Hip roof.
			const alongX: boolean = spanX >= spanZ;
			const half: number = (alongX ? spanZ : spanX) / 2;
			const rise: number = half * tan;
			const ridge: number = Math.abs(spanX - spanZ) / 2;
			if (alongX) {
				const ra: Vec3 = [xm - ridge, y + rise, zm];
				const rb: Vec3 = [xm + ridge, y + rise, zm];
				list.add([[x0, y, z0], [x1, y, z0], rb, ra], roofTile, 'roof', 2, [0, 1, -1]);
				list.add([[x0, y, z1], [x1, y, z1], rb, ra], roofTile, 'roof', 2, [0, 1, 1]);
				list.add([[x0, y, z0], [x0, y, z1], ra], roofTile, 'roof', 2, [-1, 1, 0]);
				list.add([[x1, y, z0], [x1, y, z1], rb], roofTile, 'roof', 2, [1, 1, 0]);
			} else {
				const ra: Vec3 = [xm, y + rise, zm - ridge];
				const rb: Vec3 = [xm, y + rise, zm + ridge];
				list.add([[x0, y, z0], [x0, y, z1], rb, ra], roofTile, 'roof', 2, [-1, 1, 0]);
				list.add([[x1, y, z0], [x1, y, z1], rb, ra], roofTile, 'roof', 2, [1, 1, 0]);
				list.add([[x0, y, z0], [x1, y, z0], ra], roofTile, 'roof', 2, [0, 1, -1]);
				list.add([[x0, y, z1], [x1, y, z1], rb], roofTile, 'roof', 2, [0, 1, 1]);
			}
			topMost = Math.max(topMost, y + rise);
		}
	}
	return topMost;
}

function addProps(spec: BuildingSpec, rects: CellRect[], width: number, depth: number, list: PieceList, rng: Rng): number {
	if (spec.roof !== 'flat' && !spec.props.includes('chimney')) return 0;
	const biggest: CellRect = rects.reduce((a: CellRect, b: CellRect): CellRect => ((b.c1 - b.c0 + 1) * (b.r1 - b.r0 + 1) * 1000 + b.floors > (a.c1 - a.c0 + 1) * (a.r1 - a.r0 + 1) * 1000 + a.floors ? b : a));
	const bay: number = spec.bay;
	const x0: number = -width / 2 + biggest.c0 * bay;
	const x1: number = -width / 2 + (biggest.c1 + 1) * bay;
	const z0: number = -depth / 2 + biggest.r0 * bay;
	const z1: number = -depth / 2 + (biggest.r1 + 1) * bay;
	const y: number = roofHeight(spec, biggest.floors);
	let top: number = 0;
	const metal: TileRef = pick(spec, 'metal');
	const brick: TileRef = pick(spec, 'brick');
	for (const prop of spec.props) {
		const size: [number, number, number] = PROP_SIZES[prop];
		const margin: number = 1.2;
		const room = (axis: number, a: number, b: number): number => Math.max(0, b - a - axis - margin * 2);
		const px: number = x0 + margin + size[0] / 2 + rng.next() * room(size[0], x0, x1);
		const pz: number = z0 + margin + size[2] / 2 + rng.next() * room(size[2], z0, z1);
		if (prop === 'spire') {
			const cx: number = (x0 + x1) / 2;
			const cz: number = (z0 + z1) / 2;
			const hw: number = size[0] / 2;
			const apex: Vec3 = [cx, y + size[1], cz];
			const c: Vec3[] = [[cx - hw, y, cz - hw], [cx + hw, y, cz - hw], [cx + hw, y, cz + hw], [cx - hw, y, cz + hw]];
			list.add([c[0], c[1], apex], metal, 'prop', 1, [0, 0.3, -1]);
			list.add([c[1], c[2], apex], metal, 'prop', 1, [1, 0.3, 0]);
			list.add([c[2], c[3], apex], metal, 'prop', 1, [0, 0.3, 1]);
			list.add([c[3], c[0], apex], metal, 'prop', 1, [-1, 0.3, 0]);
			top = Math.max(top, y + size[1]);
			continue;
		}
		const height: number = prop === 'chimney' ? size[1] * (0.8 + rng.next() * 0.6) : size[1];
		list.box(px, y, pz, size[0], height, size[2], prop === 'chimney' ? brick : metal, prop === 'antenna' ? 1 : 0);
		top = Math.max(top, y + height);
	}
	return top;
}

function addAwnings(spec: BuildingSpec, runs: FacadeRun[], list: PieceList): void {
	if (!spec.awning) return;
	const tile: TileRef = pick(spec, 'awning');
	for (const run of runs) {
		if (!run.front || run.rows.every((row: FacadeRow): boolean => row.y0 < 0 || row.y0 > 0.01)) continue;
		const lowest = run.rows.find((row: FacadeRow): boolean => Math.abs(row.y0) < 0.01);
		if (!lowest) continue;
		const width: number = run.bays * run.bayWidth;
		const yWall: number = lowest.height * 0.82;
		const yOut: number = lowest.height * 0.66;
		const out: number = 1.3;
		const o: Vec3 = run.origin;
		const a: Vec3 = run.along;
		const n: Vec3 = run.normal;
		const p = (t: number, y: number, d: number): Vec3 => [o[0] + a[0] * t + n[0] * d, y, o[2] + a[2] * t + n[2] * d];
		list.add([p(0, yWall, 0.02), p(width, yWall, 0.02), p(width, yOut, out), p(0, yOut, out)], tile, 'awning', 0, [n[0], 0.6, n[2]]);
	}
}

/** Builds the structured model of a building from its spec. Pure and deterministic. */
export function buildModel(spec: BuildingSpec): BuildingModel {
	if (spec.archetype === 'wind_turbine') return buildTurbine(spec);
	if (isTowerShape(spec.shape)) return addFacadeDetail(buildTower(spec));
	const rng: Rng = new Rng(spec.seed * 1013904223 + 0x1234567);
	const grid: FloorGrid = makeShape(spec.shape, spec.nx, spec.nz, spec.floors, rng);
	const width: number = spec.nx * spec.bay;
	const depth: number = spec.nz * spec.bay;
	const rects: CellRect[] = rectangles(grid);
	const facades: FacadeRun[] = buildRuns(spec, grid, width, depth);
	const list: PieceList = new PieceList();
	const roofTop: number = addRoofs(spec, grid, rects, width, depth, list);
	const propTop: number = addProps(spec, rects, width, depth, list, new Rng(spec.seed * 31 + 5));
	addAwnings(spec, facades, list);
	const volumes: Volume[] = rects.map((r: CellRect): Volume => ({
		x0: -width / 2 + r.c0 * spec.bay,
		x1: -width / 2 + (r.c1 + 1) * spec.bay,
		z0: -depth / 2 + r.r0 * spec.bay,
		z1: -depth / 2 + (r.r1 + 1) * spec.bay,
		height: roofHeight(spec, r.floors),
	}));
	return addFacadeDetail({ spec, width, depth, height: Math.max(roofTop, propTop), facades, pieces: list.pieces, volumes });
}

