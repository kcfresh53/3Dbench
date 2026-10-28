import type { ByteGrid } from '../grid';
import type { GridRect } from '../types';
import type { Heightfield } from './heightfield';

/** Paints surface ids (1-based, 0 = automatic) onto the cells under a disc or square. */
export function paintSurface(hf: Heightfield, grid: ByteGrid, x: number, z: number, radius: number, id: number, shape: 'round' | 'square'): GridRect {
	const c0: number = Math.max(0, Math.floor(hf.colAt(x - radius)));
	const c1: number = Math.min(grid.cols - 1, Math.floor(hf.colAt(x + radius)));
	const r0: number = Math.max(0, Math.floor(hf.rowAt(z - radius)));
	const r1: number = Math.min(grid.rows - 1, Math.floor(hf.rowAt(z + radius)));
	for (let r: number = r0; r <= r1; r++) {
		for (let c: number = c0; c <= c1; c++) {
			const dx: number = hf.worldX(c) + hf.cellSize / 2 - x;
			const dz: number = hf.worldZ(r) + hf.cellSize / 2 - z;
			const inside: boolean = shape === 'square' ? Math.max(Math.abs(dx), Math.abs(dz)) <= radius : Math.hypot(dx, dz) <= radius;
			if (inside) grid.set(c, r, id);
		}
	}
	return { c0, r0, c1: c1 + 1, r1: r1 + 1 };
}
