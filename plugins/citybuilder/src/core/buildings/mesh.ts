import type { PropFace, PropMesh, Vec2, Vec3 } from '../types';
import type { BuildingModel, FacadeRow, FacadeRun, ModelPiece, Volume } from './types';
import { oriented } from './massing';
import { tileRef, tileKind } from './tiles';

export type Lod = 0 | 1 | 2;

export const TILE_MATERIAL = 'tile:';
export const FACADE_MATERIAL = 'facade:';

export function tileMaterial(ref: number): string {
	return `${TILE_MATERIAL}${ref}`;
}

/** A baked wall strip: one storey of a wall, cut into pieces of at most `MAX_STRIP_M` metres. */
export function facadeMaterial(runId: number, row: number, chunk: number): string {
	return `${FACADE_MATERIAL}${runId}.${row}.${chunk}`;
}

export interface FacadeStripId {
	run: number;
	row: number;
	chunk: number;
}

export function parseFacadeMaterial(material: string): FacadeStripId {
	const [run, row, chunk] = material.slice(FACADE_MATERIAL.length).split('.').map(Number);
	return { run, row, chunk };
}

/** Longest baked strip in metres; wider walls are cut so a single storey never needs a huge texture. */
export const MAX_STRIP_M: number = 16;

/** Bays in one baked strip of a run. */
export function baysPerStrip(run: FacadeRun): number {
	return Math.max(1, Math.floor(MAX_STRIP_M / run.bayWidth));
}

/** Storeys that a level of detail keeps (foundation rows are dropped from LOD 1). */
export function bakedRows(run: FacadeRun, lod: Lod): Array<{ index: number; row: FacadeRow }> {
	const out: Array<{ index: number; row: FacadeRow }> = [];
	run.rows.forEach((row: FacadeRow, index: number): void => {
		if ((lod === 0 && !row.nativeDetail) || (lod > 0 && row.y0 >= 0)) out.push({ index, row });
	});
	return out;
}

class MeshBuilder {
	readonly positions: Vec3[] = [];
	readonly faces: PropFace[] = [];

	quad(corners: Vec3[], uvs: Vec2[], material: string, normals?: Vec3[]): void {
		const base: number = this.positions.length;
		for (const c of corners) this.positions.push(c);
		this.faces.push({ indices: corners.map((_: Vec3, i: number): number => base + i), uvs, material, normals });
	}

	toMesh(): PropMesh {
		return { positions: this.positions, faces: this.faces };
	}
}

/** Point on a wall, including the taper and crown of a lofted tower. */
function rowPoint(run: FacadeRun, row: FacadeRow, t: number, top: boolean): Vec3 {
	if (row.corners) {
		const a = row.corners[top ? 3 : 0], b = row.corners[top ? 2 : 1];
		const u = t / (run.bays * run.bayWidth);
		return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
	}
	return [run.origin[0] + run.along[0] * t, row.y0 + (top ? row.height : 0), run.origin[2] + run.along[2] * t];
}

const QUAD_UV: Vec2[] = [[0, 1], [1, 1], [1, 0], [0, 0]];

function addPieces(b: MeshBuilder, pieces: ModelPiece[], lod: Lod): void {
	for (const piece of pieces) if (piece.maxLod >= lod) b.quad(piece.corners, piece.uvs, tileMaterial(piece.tile), piece.normals);
}

/** How far inside a volume a face must lie to count as buried. Recessed windows and trims stay well clear of it. */
const BURIED_DEPTH_M: number = 0.6;

/**
 * Removes faces that sit wholly inside another part of the same building, such as the lower storeys of a tower
 * that rises out of its podium. They can never be seen, so they are never drawn, baked or exported.
 */
function dropBuried(mesh: PropMesh, model: BuildingModel): PropMesh {
	const volumes: Volume[] = model.volumes;
	if (volumes.length < 2 || model.hull) return mesh;
	const inside = (p: Vec3): boolean =>
		volumes.some((v: Volume): boolean => p[0] > v.x0 + BURIED_DEPTH_M && p[0] < v.x1 - BURIED_DEPTH_M && p[2] > v.z0 + BURIED_DEPTH_M && p[2] < v.z1 - BURIED_DEPTH_M && p[1] > BURIED_DEPTH_M && p[1] < v.height - BURIED_DEPTH_M);
	const faces: PropFace[] = mesh.faces.filter((f: PropFace): boolean => !f.indices.every((i: number): boolean => inside(mesh.positions[i])));
	if (faces.length === mesh.faces.length) return mesh;
	const remap: Map<number, number> = new Map<number, number>();
	const positions: Vec3[] = [];
	for (const f of faces) {
		f.indices = f.indices.map((i: number): number => {
			let n: number | undefined = remap.get(i);
			if (n === undefined) {
				n = positions.length;
				positions.push(mesh.positions[i]);
				remap.set(i, n);
			}
			return n;
		});
	}
	return { positions, faces };
}

/** Elliptical glass normals are analytic, so UV splits never create visible facets. */
function finishMesh(b: MeshBuilder, model: BuildingModel): PropMesh {
	const mesh = dropBuried(b.toMesh(), model);
	if (model.spec.shape !== 'rounded') return mesh;
	for (const face of mesh.faces) {
		const kind = face.material.startsWith(TILE_MATERIAL) ? tileKind(Number(face.material.slice(TILE_MATERIAL.length))) : null;
		if (face.normals) continue;
		if (!face.material.startsWith(FACADE_MATERIAL) && kind !== 'curtain' && kind !== 'curtain_band' && kind !== 'shop_glass' && kind !== 'shop_door') continue;
		face.normals = face.indices.map(i => {
			const p = mesh.positions[i];
			const x = p[0] / (model.width * model.width), z = p[2] / (model.depth * model.depth);
			const length = Math.hypot(x, z);
			return [x / length, 0, z / length];
		});
	}
	return mesh;
}

/**
 * Every bay of every floor as its own quad, textured from the shared tile atlas. This is the
 * editable, repeatable form of a building; the game-ready pass replaces it with baked facades.
 */
export function modularMesh(model: BuildingModel, lod: Lod = 0): PropMesh {
	if (lod === 2) return silhouetteMesh(model);
	const b: MeshBuilder = new MeshBuilder();
	for (const run of model.facades) {
		run.rows.forEach((row: FacadeRow): void => {
			if ((lod >= 1 && row.y0 < 0) || (lod === 0 && row.nativeDetail)) return;
			row.tiles.forEach((tile: number, bay: number): void => {
				const t0: number = bay * run.bayWidth;
				const t1: number = t0 + run.bayWidth;
				b.quad([rowPoint(run, row, t0, false), rowPoint(run, row, t1, false), rowPoint(run, row, t1, true), rowPoint(run, row, t0, true)], QUAD_UV, tileMaterial(tile));
			});
		});
	}
	addPieces(b, lod === 0 ? model.pieces : model.corePieces ?? model.pieces, lod);
	return finishMesh(b, model);
}

/** One quad per storey and strip of wall; each carries its own baked texture (`facade:<run>.<row>.<chunk>`). */
export function bakedMesh(model: BuildingModel, lod: Lod): PropMesh {
	if (lod === 2) return silhouetteMesh(model);
	const b: MeshBuilder = new MeshBuilder();
	for (const run of model.facades) {
		const per: number = baysPerStrip(run);
		for (const { index, row } of bakedRows(run, lod)) {
			for (let chunk: number = 0; chunk * per < run.bays; chunk++) {
				const t0: number = chunk * per * run.bayWidth;
				const t1: number = Math.min(run.bays, (chunk + 1) * per) * run.bayWidth;
				b.quad([rowPoint(run, row, t0, false), rowPoint(run, row, t1, false), rowPoint(run, row, t1, true), rowPoint(run, row, t0, true)], QUAD_UV, facadeMaterial(run.id, index, chunk));
			}
		}
	}
	addPieces(b, lod === 0 ? model.pieces : model.corePieces ?? model.pieces, lod);
	return finishMesh(b, model);
}

/** Boxes for the building's blocks: the coarsest level of detail. */
export function silhouetteMesh(model: BuildingModel): PropMesh {
	const b: MeshBuilder = new MeshBuilder();
	if (model.hull) {
		addPieces(b, model.hull, 2);
		return finishMesh(b, model);
	}
	const wall: string = tileMaterial(tileRef('wall', model.spec.palette));
	const roof: string = tileMaterial(tileRef('roof_flat', model.spec.palette));
	const add = (corners: Vec3[], facing: Vec3, material: string): void => {
		const o = oriented(corners, QUAD_UV, facing);
		b.quad(o.corners, o.uvs, material);
	};
	for (const v of model.volumes) {
		const { x0, x1, z0, z1, height: h } = v;
		add([[x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1]], [0, 1, 0], roof);
		add([[x0, 0, z0], [x1, 0, z0], [x1, h, z0], [x0, h, z0]], [0, 0, -1], wall);
		add([[x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1]], [0, 0, 1], wall);
		add([[x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0]], [-1, 0, 0], wall);
		add([[x1, 0, z0], [x1, 0, z1], [x1, h, z1], [x1, h, z0]], [1, 0, 0], wall);
	}
	return finishMesh(b, model);
}

export interface CollisionBox {
	center: Vec3;
	size: Vec3;
}

/** Axis-aligned boxes that cover the building, in the building's local frame. */
export function collisionBoxes(model: BuildingModel): CollisionBox[] {
	return model.volumes.map((v: Volume): CollisionBox => ({
		center: [(v.x0 + v.x1) / 2, v.height / 2, (v.z0 + v.z1) / 2],
		size: [v.x1 - v.x0, v.height, v.z1 - v.z0],
	}));
}

export function meshTriangles(mesh: PropMesh): number {
	let total: number = 0;
	for (const f of mesh.faces) total += f.indices.length - 2;
	return total;
}
