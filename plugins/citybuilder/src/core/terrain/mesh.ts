import type { Heightfield } from './heightfield';
import { Heightfield as HF } from './heightfield';

/** Flat buffers for one rectangular patch of terrain, ready to hand to a GPU or to a mesh builder. */
export interface TerrainPatch {
	positions: Float32Array;
	normals: Float32Array;
	/** Planar UVs covering the whole map, so one baked albedo texture serves every patch. */
	uvs: Float32Array;
	indices: Uint32Array;
}

/**
 * Builds the terrain between vertex columns c0..c1 and rows r0..r1. `step` skips vertices for coarser
 * levels of detail. Diagonals alternate in a checkerboard, matching `Heightfield.sample`.
 */
export function buildPatch(hf: Heightfield, c0: number, r0: number, c1: number, r1: number, step: number = 1): TerrainPatch {
	const cs: number[] = [];
	for (let c: number = c0; c < c1; c += step) cs.push(c);
	cs.push(c1);
	const rs: number[] = [];
	for (let r: number = r0; r < r1; r += step) rs.push(r);
	rs.push(r1);
	const nc: number = cs.length;
	const nr: number = rs.length;
	const positions: Float32Array = new Float32Array(nc * nr * 3);
	const normals: Float32Array = new Float32Array(nc * nr * 3);
	const uvs: Float32Array = new Float32Array(nc * nr * 2);
	for (let j: number = 0; j < nr; j++) {
		for (let i: number = 0; i < nc; i++) {
			const x: number = hf.worldX(cs[i]);
			const z: number = hf.worldZ(rs[j]);
			const k: number = j * nc + i;
			positions[k * 3] = x;
			positions[k * 3 + 1] = hf.get(cs[i], rs[j]);
			positions[k * 3 + 2] = z;
			// Central differences on the grid itself, so shading is smooth across patch borders.
			const hx: number = hf.get(Math.min(hf.cols - 1, cs[i] + 1), rs[j]) - hf.get(Math.max(0, cs[i] - 1), rs[j]);
			const hz: number = hf.get(cs[i], Math.min(hf.rows - 1, rs[j] + 1)) - hf.get(cs[i], Math.max(0, rs[j] - 1));
			const sx: number = (Math.min(hf.cols - 1, cs[i] + 1) - Math.max(0, cs[i] - 1)) * hf.cellSize;
			const sz: number = (Math.min(hf.rows - 1, rs[j] + 1) - Math.max(0, rs[j] - 1)) * hf.cellSize;
			const nx: number = -hx / sx;
			const nz: number = -hz / sz;
			const l: number = Math.hypot(nx, 1, nz);
			normals[k * 3] = nx / l;
			normals[k * 3 + 1] = 1 / l;
			normals[k * 3 + 2] = nz / l;
			uvs[k * 2] = (x - hf.originX) / hf.width;
			uvs[k * 2 + 1] = (z - hf.originZ) / hf.depth;
		}
	}
	const indices: Uint32Array = new Uint32Array((nc - 1) * (nr - 1) * 6);
	let n: number = 0;
	for (let j: number = 0; j < nr - 1; j++) {
		for (let i: number = 0; i < nc - 1; i++) {
			const a: number = j * nc + i; // (c, r)
			const b: number = a + 1; // (c+1, r)
			const c: number = a + nc; // (c, r+1)
			const d: number = c + 1; // (c+1, r+1)
			if (HF.diagonalForward(cs[i], rs[j])) {
				indices[n++] = a; indices[n++] = c; indices[n++] = d;
				indices[n++] = a; indices[n++] = d; indices[n++] = b;
			} else {
				indices[n++] = a; indices[n++] = c; indices[n++] = b;
				indices[n++] = b; indices[n++] = c; indices[n++] = d;
			}
		}
	}
	return { positions, normals, uvs, indices };
}

export interface PatchRange {
	c0: number;
	r0: number;
	c1: number;
	r1: number;
}

/** Splits the vertex grid into square patches of `cells` cells, so edits rebuild only what they touch. */
export function patchRanges(hf: Heightfield, cells: number): PatchRange[] {
	const out: PatchRange[] = [];
	for (let r: number = 0; r < hf.rows - 1; r += cells) {
		for (let c: number = 0; c < hf.cols - 1; c += cells) {
			out.push({ c0: c, r0: r, c1: Math.min(hf.cols - 1, c + cells), r1: Math.min(hf.rows - 1, r + cells) });
		}
	}
	return out;
}

/** Index of the patch that holds vertex (c, r). */
export function patchIndexAt(hf: Heightfield, cells: number, c: number, r: number): number {
	const perRow: number = Math.ceil((hf.cols - 1) / cells);
	return Math.floor(Math.min(r, hf.rows - 2) / cells) * perRow + Math.floor(Math.min(c, hf.cols - 2) / cells);
}

export function patchCount(hf: Heightfield, cells: number): number {
	return Math.ceil((hf.cols - 1) / cells) * Math.ceil((hf.rows - 1) / cells);
}
