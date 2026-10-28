import type { PropFace, PropMesh, Vec2, Vec3 } from '../types';
import type { BuildingModel, FacadeRow, FacadeRun, ModelPiece, Volume } from './types';
import { oriented } from './massing';
import { tileRef } from './tiles';

export type Lod = 0 | 1 | 2;

export const TILE_MATERIAL = 'tile:';
export const FACADE_MATERIAL = 'facade:';

export function tileMaterial(ref: number): string {
	return `${TILE_MATERIAL}${ref}`;
}

export function facadeMaterial(runId: number): string {
	return `${FACADE_MATERIAL}${runId}`;
}

class MeshBuilder {
	readonly positions: Vec3[] = [];
	readonly faces: PropFace[] = [];

	quad(corners: Vec3[], uvs: Vec2[], material: string): void {
		const base: number = this.positions.length;
		for (const c of corners) this.positions.push(c);
		this.faces.push({ indices: corners.map((_: Vec3, i: number): number => base + i), uvs, material });
	}

	toMesh(): PropMesh {
		return { positions: this.positions, faces: this.faces };
	}
}

function at(run: FacadeRun, t: number, y: number): Vec3 {
	return [run.origin[0] + run.along[0] * t, y, run.origin[2] + run.along[2] * t];
}

const QUAD_UV: Vec2[] = [[0, 1], [1, 1], [1, 0], [0, 0]];

function addPieces(b: MeshBuilder, pieces: ModelPiece[], lod: Lod): void {
	for (const piece of pieces) if (piece.maxLod >= lod) b.quad(piece.corners, piece.uvs, tileMaterial(piece.tile));
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
			if (lod >= 1 && row.y0 < 0) return;
			row.tiles.forEach((tile: number, bay: number): void => {
				const t0: number = bay * run.bayWidth;
				const t1: number = t0 + run.bayWidth;
				b.quad([at(run, t0, row.y0), at(run, t1, row.y0), at(run, t1, row.y0 + row.height), at(run, t0, row.y0 + row.height)], QUAD_UV, tileMaterial(tile));
			});
		});
	}
	addPieces(b, model.pieces, lod);
	return b.toMesh();
}

/** Total height of a run's rows and the y of its bottom edge. */
export function runExtent(run: FacadeRun, includeFoundation: boolean): { y0: number; y1: number } {
	const rows: FacadeRow[] = includeFoundation ? run.rows : run.rows.filter((r: FacadeRow): boolean => r.y0 >= 0);
	return { y0: rows[0].y0, y1: rows[rows.length - 1].y0 + rows[rows.length - 1].height };
}

/** One quad per wall; each carries its own baked texture (`facade:<run id>`). */
export function bakedMesh(model: BuildingModel, lod: Lod): PropMesh {
	if (lod === 2) return silhouetteMesh(model);
	const b: MeshBuilder = new MeshBuilder();
	for (const run of model.facades) {
		const { y0, y1 } = runExtent(run, lod === 0);
		const width: number = run.bays * run.bayWidth;
		b.quad([at(run, 0, y0), at(run, width, y0), at(run, width, y1), at(run, 0, y1)], QUAD_UV, facadeMaterial(run.id));
	}
	addPieces(b, model.pieces, lod);
	return b.toMesh();
}

/** Boxes for the building's blocks: the coarsest level of detail. */
export function silhouetteMesh(model: BuildingModel): PropMesh {
	const b: MeshBuilder = new MeshBuilder();
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
	return b.toMesh();
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
