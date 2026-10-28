import type { DistrictType } from '../district/types';
import { districtById } from '../district/library';
import { DistrictMap } from '../district/map';
import { SpatialHash } from '../grid';
import type { Obb } from '../geometry2d';
import { obbBounds, obbOverlap, obbSegmentDistance } from '../geometry2d';
import { Rng, hashString } from '../math';
import { RoadIndex } from '../roads/corridor';
import type { RoadCorridor, RoadJunction, RoadSample, RoadSet } from '../roads/corridor';
import { Heightfield } from '../terrain/heightfield';
import type { Lot, LotSettings } from './types';

const SEARCH_STEP = 3;

interface Frame {
	x: number;
	z: number;
	fx: number;
	fz: number;
}

/** Position and unit forward direction at a distance along a polyline. */
function frameAt(points: RoadSample[], cumulative: number[], distance: number): Frame {
	let i: number = 1;
	while (i < cumulative.length - 1 && cumulative[i] < distance) i++;
	const a: RoadSample = points[i - 1];
	const b: RoadSample = points[i];
	const span: number = Math.max(1e-6, cumulative[i] - cumulative[i - 1]);
	const t: number = Math.max(0, Math.min(1, (distance - cumulative[i - 1]) / span));
	const dx: number = b.x - a.x;
	const dz: number = b.z - a.z;
	const l: number = Math.hypot(dx, dz) || 1;
	return { x: a.x + dx * t, z: a.z + dz * t, fx: dx / l, fz: dz / l };
}

function probeSamples(box: Obb): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	for (const [a, b] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
		const lx: number = a * box.hw * 0.9;
		const lz: number = b * box.hd * 0.9;
		out.push([box.cx + box.ux * lx - box.uz * lz, box.cz + box.uz * lx + box.ux * lz]);
	}
	return out;
}

interface Context {
	hf: Heightfield;
	districts: DistrictMap;
	index: RoadIndex;
	junctions: RoadJunction[];
	settings: LotSettings;
	waterLevel: number;
	placed: SpatialHash<Lot>;
}

function blockedByRoads(ctx: Context, box: Obb, own: RoadCorridor | null): boolean {
	const b = obbBounds(box);
	const pad: number = 40;
	for (const seg of ctx.index.nearby(b.minX - pad, b.minZ - pad, b.maxX + pad, b.maxZ + pad)) {
		const distance: number = obbSegmentDistance(box, seg.ax, seg.az, seg.bx, seg.bz);
		const side: number = (seg.bx - seg.ax) * (box.cz - seg.az) - (seg.bz - seg.az) * (box.cx - seg.ax);
		const extent: number = side > 0 ? seg.road.rightExtent : seg.road.leftExtent;
		if (distance < extent + ctx.settings.roadMargin * (seg.road === own ? 0.4 : 1)) return true;
	}
	return false;
}

function nearJunction(ctx: Context, box: Obb): boolean {
	const reach: number = Math.hypot(box.hw, box.hd);
	for (const j of ctx.junctions) {
		const dx: number = j.x - box.cx;
		const dz: number = j.z - box.cz;
		if (Math.hypot(dx, dz) > reach + j.radius) continue;
		if (obbSegmentDistance(box, j.x, j.z, j.x, j.z) < j.radius) return true;
	}
	return false;
}

function overlapsLots(ctx: Context, box: Obb, gap: number): boolean {
	const b = obbBounds(box);
	for (const other of ctx.placed.query(b.minX - gap, b.minZ - gap, b.maxX + gap, b.maxZ + gap)) {
		if (obbOverlap(box, other.obb, gap)) return true;
	}
	return false;
}

/** Terrain checks: inside the map, above water, gentle enough. Returns relief and pad height or null. */
function groundOf(ctx: Context, box: Obb): { relief: number; pad: number } | null {
	let lo: number = Infinity;
	let hi: number = -Infinity;
	let sum: number = 0;
	let count: number = 0;
	for (const [x, z] of probeSamples(box)) {
		if (!ctx.hf.containsWorld(x, z)) return null;
		const h: number = ctx.hf.sample(x, z);
		lo = Math.min(lo, h);
		hi = Math.max(hi, h);
		sum += h;
		count++;
	}
	if (lo < ctx.waterLevel + ctx.settings.waterMargin) return null;
	const relief: number = hi - lo;
	if (relief > ctx.settings.maxSlope * Math.max(box.hw, box.hd) * 2) return null;
	return { relief, pad: sum / count };
}

function districtOfBox(ctx: Context, box: Obb): DistrictType | null {
	const counts: Map<number, number> = new Map();
	const samples: Array<[number, number]> = probeSamples(box);
	for (const [x, z] of samples) {
		const id: number = ctx.districts.idAt(x, z);
		counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	let bestId: number = 0;
	let best: number = 0;
	for (const [id, n] of counts) {
		if (n > best) {
			best = n;
			bestId = id;
		}
	}
	if (bestId === 0 || best / samples.length < ctx.settings.districtShare) return null;
	const district: DistrictType | undefined = districtById(bestId);
	return district && district.buildable ? district : null;
}

/** Lays lots along one side of one road. */
function lotsAlongSide(ctx: Context, road: RoadCorridor, side: 'left' | 'right', out: Lot[]): void {
	const points: RoadSample[] = road.points;
	if (points.length < 2) return;
	const cumulative: number[] = [0];
	for (let i: number = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
	const total: number = cumulative[cumulative.length - 1];
	const extent: number = side === 'right' ? road.rightExtent : road.leftExtent;
	// Right of travel is (-fz, fx); the left is its opposite.
	const sign: number = side === 'right' ? 1 : -1;
	const rng: Rng = new Rng(hashString(`${road.id}:${side}`) ^ ctx.settings.seed);
	let s: number = 1;
	let index: number = 0;
	while (s < total - 1) {
		const probe: Frame = frameAt(points, cumulative, Math.min(total, s + 3));
		const probeX: number = probe.x + -probe.fz * sign * (extent + 3);
		const probeZ: number = probe.z + probe.fx * sign * (extent + 3);
		const district: DistrictType | undefined = districtById(ctx.districts.idAt(probeX, probeZ));
		if (!district || !district.buildable) {
			s += SEARCH_STEP;
			continue;
		}
		const width: number = rng.range(district.lotWidth[0], district.lotWidth[1]);
		const depth: number = rng.range(district.lotDepth[0], district.lotDepth[1]);
		if (s + width > total - 1) break;
		const start: Frame = frameAt(points, cumulative, s);
		const end: Frame = frameAt(points, cumulative, s + width);
		const mid: Frame = frameAt(points, cumulative, s + width / 2);
		let tx: number = end.x - start.x;
		let tz: number = end.z - start.z;
		const tl: number = Math.hypot(tx, tz) || 1;
		tx /= tl;
		tz /= tl;
		const lateral: number = extent + district.frontGap + depth / 2;
		const cx: number = mid.x + -tz * sign * lateral;
		const cz: number = mid.z + tx * sign * lateral;
		// Width axis follows travel on the right side and runs against it on the left, keeping the frame a rotation.
		const box: Obb = { cx, cz, hw: width / 2, hd: depth / 2, ux: tx * sign, uz: tz * sign };
		const pass: boolean = !blockedByRoads(ctx, box, road) && !nearJunction(ctx, box);
		const ground = pass ? groundOf(ctx, box) : null;
		const actual: DistrictType | null = ground ? districtOfBox(ctx, box) : null;
		if (!ground || !actual || overlapsLots(ctx, box, Math.max(0, district.sideGap) * 0.5)) {
			s += SEARCH_STEP;
			continue;
		}
		const lot: Lot = {
			id: `${road.id}:${side[0]}${index}`,
			roadId: road.id,
			side,
			obb: box,
			width,
			depth,
			districtId: actual.id,
			padHeight: ground.pad,
			relief: ground.relief,
			roadLanes: road.lanes,
			roadDistance: lateral,
			value: 0.5,
		};
		out.push(lot);
		const b = obbBounds(box);
		ctx.placed.insert(lot, b.minX, b.minZ, b.maxX, b.maxZ);
		index++;
		s += width + district.sideGap;
	}
}

/** Fill painted interiors too, including districts with no road frontage. Road lots win first. */
function lotsInDistricts(ctx: Context, out: Lot[]): void {
	const step = Math.max(6, ctx.hf.cellSize);
	for (let z = ctx.hf.originZ + step / 2; z < ctx.hf.originZ + ctx.hf.depth; z += step) {
		for (let x = ctx.hf.originX + step / 2; x < ctx.hf.originX + ctx.hf.width; x += step) {
			const district = districtById(ctx.districts.idAt(x, z));
			if (!district?.buildable) continue;
			const id = `area:${Math.round((x - ctx.hf.originX) / step)}:${Math.round((z - ctx.hf.originZ) / step)}`;
			const rng = new Rng(hashString(id) ^ ctx.settings.seed);
			const width = rng.range(...district.lotWidth);
			const depth = rng.range(...district.lotDepth);
			const box: Obb = { cx: x, cz: z, hw: width / 2, hd: depth / 2, ux: 1, uz: 0 };
			if (overlapsLots(ctx, box, Math.max(1, district.sideGap)) || blockedByRoads(ctx, box, null) || nearJunction(ctx, box)) continue;
			// Require every covered cell to match: small brush islands must not spill buildings outside paint.
			let inside = true;
			for (let zz = z - depth / 2; zz <= z + depth / 2 && inside; zz += Math.min(2, ctx.hf.cellSize / 2)) {
				for (let xx = x - width / 2; xx <= x + width / 2; xx += Math.min(2, ctx.hf.cellSize / 2)) {
					if (ctx.districts.idAt(xx, zz) !== district.id) { inside = false; break; }
				}
			}
			if (!inside || districtOfBox(ctx, box)?.id !== district.id) continue;
			const ground = groundOf(ctx, box);
			if (!ground) continue;
			const lot: Lot = { id, roadId: '', side: 'right', obb: box, width, depth, districtId: district.id,
				padHeight: ground.pad, relief: ground.relief, roadLanes: 0, roadDistance: 0, value: 0.5 };
			out.push(lot);
			const b = obbBounds(box);
			ctx.placed.insert(lot, b.minX, b.minZ, b.maxX, b.maxZ);
		}
	}
}

/**
 * Generates every lot for the current roads and zoning. Road frontage is filled first, followed by painted interiors. Lots appear
 * inside a buildable district, clear of junctions and other roads, on land that is dry and gentle.
 * The result is deterministic for a given input.
 */
export function generateLots(roads: RoadSet, districts: DistrictMap, hf: Heightfield, waterLevel: number, settings: LotSettings): Lot[] {
	const ctx: Context = {
		hf,
		districts,
		index: new RoadIndex(roads),
		junctions: roads.junctions,
		settings,
		waterLevel,
		placed: new SpatialHash<Lot>(24),
	};
	const lots: Lot[] = [];
	const ordered: RoadCorridor[] = roads.corridors.filter((r: RoadCorridor): boolean => r.structure === 'ground').sort((a: RoadCorridor, b: RoadCorridor): number => (a.id < b.id ? -1 : 1));
	for (const road of ordered) {
		lotsAlongSide(ctx, road, 'right', lots);
		lotsAlongSide(ctx, road, 'left', lots);
	}
	lotsInDistricts(ctx, lots);
	return lots;
}

