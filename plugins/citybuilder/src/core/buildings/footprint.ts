import { Rng } from '../math';
import type { ShapeKind } from './types';

/** Floors per grid cell; 0 means no building on that cell. */
export interface FloorGrid {
	nx: number;
	nz: number;
	floors: Uint8Array;
}

export interface CellRect {
	c0: number;
	r0: number;
	c1: number;
	r1: number;
	floors: number;
}

export function floorsAt(grid: FloorGrid, ix: number, iz: number): number {
	return ix < 0 || iz < 0 || ix >= grid.nx || iz >= grid.nz ? 0 : grid.floors[iz * grid.nx + ix];
}

function blank(nx: number, nz: number): FloorGrid {
	return { nx, nz, floors: new Uint8Array(nx * nz) };
}

function fillRect(grid: FloorGrid, c0: number, r0: number, c1: number, r1: number, floors: number): void {
	for (let r: number = r0; r <= r1; r++) for (let c: number = c0; c <= c1; c++) grid.floors[r * grid.nx + c] = floors;
}

/** The shapes an archetype may ask for; sizes too small for a shape fall back to a plain box. */
export function effectiveShape(kind: ShapeKind, nx: number, nz: number, floors: number): ShapeKind {
	if (kind === 'L' && nx >= 3 && nz >= 3) return 'L';
	if (kind === 'U' && nx >= 5 && nz >= 4) return 'U';
	if (kind === 'T' && nx >= 5 && nz >= 3) return 'T';
	if (kind === 'podium' && nx >= 4 && nz >= 4 && floors >= 5) return 'podium';
	if (kind === 'stepped' && nx >= 4 && nz >= 4 && floors >= 6) return 'stepped';
	return 'rect';
}

/** Builds the floor grid of a shape. `rng` only chooses cut positions, so equal inputs give equal grids. */
export function makeShape(kind: ShapeKind, nx: number, nz: number, floors: number, rng: Rng): FloorGrid {
	const grid: FloorGrid = blank(nx, nz);
	const shape: ShapeKind = effectiveShape(kind, nx, nz, floors);
	fillRect(grid, 0, 0, nx - 1, nz - 1, floors);
	switch (shape) {
		case 'L': {
			const cutX: number = rng.int(1, Math.max(1, nx - 2));
			const cutZ: number = rng.int(1, Math.max(1, nz - 2));
			const corner: number = rng.int(1, 3);
			// Corner 0 (front-left) stays whole so the street side keeps its entrance.
			if (corner === 1) fillRect(grid, nx - cutX, 0, nx - 1, cutZ - 1, 0);
			else if (corner === 2) fillRect(grid, 0, nz - cutZ, cutX - 1, nz - 1, 0);
			else fillRect(grid, nx - cutX, nz - cutZ, nx - 1, nz - 1, 0);
			break;
		}
		case 'U': {
			const notchW: number = rng.int(1, nx - 4);
			const notchD: number = rng.int(1, nz - 3);
			const left: number = Math.floor((nx - notchW) / 2);
			fillRect(grid, left, nz - notchD, left + notchW - 1, nz - 1, 0);
			break;
		}
		case 'T': {
			const stemW: number = Math.max(2, Math.round(nx / 2));
			const left: number = Math.floor((nx - stemW) / 2);
			const barD: number = Math.max(1, Math.floor(nz / 3));
			fillRect(grid, 0, barD, left - 1, nz - 1, 0);
			fillRect(grid, left + stemW, barD, nx - 1, nz - 1, 0);
			break;
		}
		case 'podium': {
			const base: number = Math.min(floors - 1, Math.max(2, Math.round(floors * 0.2)));
			fillRect(grid, 0, 0, nx - 1, nz - 1, base);
			const mx: number = Math.max(1, Math.floor(nx / 4));
			const mz: number = Math.max(1, Math.floor(nz / 4));
			fillRect(grid, mx, mz, nx - 1 - mx, nz - 1 - mz, floors);
			break;
		}
		case 'stepped': {
			const tiers: number = Math.min(3, Math.floor(Math.min(nx, nz) / 2));
			for (let t: number = 0; t < tiers; t++) {
				const f: number = Math.max(1, floors - Math.round((floors * t) / (tiers + 0.5) * 0.7));
				fillRect(grid, t, t, nx - 1 - t, nz - 1 - t, t === 0 ? Math.max(1, Math.round(floors * 0.55)) : f);
			}
			// Raise the core to full height.
			if (tiers >= 1) fillRect(grid, tiers, tiers, nx - 1 - tiers, nz - 1 - tiers, floors);
			break;
		}
		default:
			break;
	}
	return grid;
}

/** Greedy decomposition of equal-height cells into rectangles. */
export function rectangles(grid: FloorGrid): CellRect[] {
	const used: Uint8Array = new Uint8Array(grid.nx * grid.nz);
	const out: CellRect[] = [];
	for (let r: number = 0; r < grid.nz; r++) {
		for (let c: number = 0; c < grid.nx; c++) {
			const f: number = floorsAt(grid, c, r);
			if (f === 0 || used[r * grid.nx + c]) continue;
			let c1: number = c;
			while (c1 + 1 < grid.nx && floorsAt(grid, c1 + 1, r) === f && !used[r * grid.nx + c1 + 1]) c1++;
			let r1: number = r;
			outer: while (r1 + 1 < grid.nz) {
				for (let k: number = c; k <= c1; k++) {
					if (floorsAt(grid, k, r1 + 1) !== f || used[(r1 + 1) * grid.nx + k]) break outer;
				}
				r1++;
			}
			for (let j: number = r; j <= r1; j++) for (let k: number = c; k <= c1; k++) used[j * grid.nx + k] = 1;
			out.push({ c0: c, r0: r, c1, r1, floors: f });
		}
	}
	return out;
}
