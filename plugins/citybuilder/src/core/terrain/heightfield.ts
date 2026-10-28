import type { GridRect, Vec3 } from '../types';
import { clamp } from '../math';

export interface TerrainSpec {
	/** Vertices along X. */
	cols: number;
	/** Vertices along Z. */
	rows: number;
	/** Distance between neighbouring vertices, metres. */
	cellSize: number;
}

export const MIN_VERTICES = 17;
export const MAX_VERTICES = 513;

/**
 * Regular height grid centred on the world origin. Vertex (c, r) sits at
 * (originX + c * cellSize, height, originZ + r * cellSize). Every cell is split by one diagonal;
 * which one alternates in a checkerboard so slopes do not all lean the same way. `sample` follows
 * that exact triangulation, so props placed on the ground sit on the rendered surface.
 */
export class Heightfield {
	readonly cols: number;
	readonly rows: number;
	readonly cellSize: number;
	readonly originX: number;
	readonly originZ: number;
	readonly heights: Float32Array;
	/** Increments on every edit, so caches can tell when to rebuild. */
	revision: number = 0;

	constructor(spec: TerrainSpec, heights?: Float32Array) {
		this.cols = clamp(Math.round(spec.cols), MIN_VERTICES, MAX_VERTICES);
		this.rows = clamp(Math.round(spec.rows), MIN_VERTICES, MAX_VERTICES);
		this.cellSize = Math.max(0.25, spec.cellSize);
		this.originX = (-(this.cols - 1) * this.cellSize) / 2;
		this.originZ = (-(this.rows - 1) * this.cellSize) / 2;
		this.heights = heights && heights.length === this.cols * this.rows ? heights : new Float32Array(this.cols * this.rows);
	}

	get width(): number {
		return (this.cols - 1) * this.cellSize;
	}

	get depth(): number {
		return (this.rows - 1) * this.cellSize;
	}

	get cellCols(): number {
		return this.cols - 1;
	}

	get cellRows(): number {
		return this.rows - 1;
	}

	index(c: number, r: number): number {
		return r * this.cols + c;
	}

	inside(c: number, r: number): boolean {
		return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
	}

	get(c: number, r: number): number {
		return this.heights[this.index(clamp(c, 0, this.cols - 1), clamp(r, 0, this.rows - 1))];
	}

	set(c: number, r: number, value: number): void {
		if (this.inside(c, r)) this.heights[this.index(c, r)] = value;
	}

	worldX(c: number): number {
		return this.originX + c * this.cellSize;
	}

	worldZ(r: number): number {
		return this.originZ + r * this.cellSize;
	}

	/** Fractional column of a world X coordinate. */
	colAt(x: number): number {
		return (x - this.originX) / this.cellSize;
	}

	rowAt(z: number): number {
		return (z - this.originZ) / this.cellSize;
	}

	containsWorld(x: number, z: number): boolean {
		const c: number = this.colAt(x);
		const r: number = this.rowAt(z);
		return c >= 0 && r >= 0 && c <= this.cols - 1 && r <= this.rows - 1;
	}

	/** True when the cell's diagonal runs from its (c, r) corner to its (c+1, r+1) corner. */
	static diagonalForward(c: number, r: number): boolean {
		return ((c + r) & 1) === 0;
	}

	/** Height of the rendered surface at a world position (clamped to the map). */
	sample(x: number, z: number): number {
		const fc: number = clamp(this.colAt(x), 0, this.cols - 1 - 1e-9);
		const fr: number = clamp(this.rowAt(z), 0, this.rows - 1 - 1e-9);
		const c: number = Math.floor(fc);
		const r: number = Math.floor(fr);
		const u: number = fc - c;
		const v: number = fr - r;
		const h00: number = this.heights[this.index(c, r)];
		const h10: number = this.heights[this.index(c + 1, r)];
		const h01: number = this.heights[this.index(c, r + 1)];
		const h11: number = this.heights[this.index(c + 1, r + 1)];
		if (Heightfield.diagonalForward(c, r)) {
			// Triangles (00, 10, 11) below the diagonal u = v and (00, 11, 01) above it.
			return u >= v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h11 - h01) * u + (h01 - h00) * v;
		}
		// Diagonal from (1, 0) to (0, 1): triangles (10, 11, 01) and (00, 10, 01).
		return u + v >= 1 ? h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v) : h00 + (h10 - h00) * u + (h01 - h00) * v;
	}

	/** Surface normal at a world position, from central differences of `sample`. */
	normal(x: number, z: number): Vec3 {
		const e: number = this.cellSize * 0.5;
		const dx: number = this.sample(x + e, z) - this.sample(x - e, z);
		const dz: number = this.sample(x, z + e) - this.sample(x, z - e);
		const nx: number = -dx / (2 * e);
		const nz: number = -dz / (2 * e);
		const l: number = Math.hypot(nx, 1, nz);
		return [nx / l, 1 / l, nz / l];
	}

	/** Steepness as rise over run (0.5 = 26.6 degrees). */
	slope(x: number, z: number): number {
		const n: Vec3 = this.normal(x, z);
		return Math.sqrt(Math.max(0, 1 - n[1] * n[1])) / Math.max(n[1], 1e-6);
	}

	/** Lowest and highest sample inside a world rectangle. */
	range(minX: number, minZ: number, maxX: number, maxZ: number): { min: number; max: number } {
		const c0: number = clamp(Math.floor(this.colAt(minX)), 0, this.cols - 1);
		const c1: number = clamp(Math.ceil(this.colAt(maxX)), 0, this.cols - 1);
		const r0: number = clamp(Math.floor(this.rowAt(minZ)), 0, this.rows - 1);
		const r1: number = clamp(Math.ceil(this.rowAt(maxZ)), 0, this.rows - 1);
		let lo: number = Infinity;
		let hi: number = -Infinity;
		for (let r: number = r0; r <= r1; r++) {
			for (let c: number = c0; c <= c1; c++) {
				const h: number = this.heights[this.index(c, r)];
				lo = Math.min(lo, h);
				hi = Math.max(hi, h);
			}
		}
		return { min: lo, max: hi };
	}

	bounds(): { min: number; max: number } {
		let lo: number = Infinity;
		let hi: number = -Infinity;
		for (let i: number = 0; i < this.heights.length; i++) {
			lo = Math.min(lo, this.heights[i]);
			hi = Math.max(hi, this.heights[i]);
		}
		return { min: lo, max: hi };
	}

	clone(): Heightfield {
		const copy: Heightfield = new Heightfield({ cols: this.cols, rows: this.rows, cellSize: this.cellSize }, new Float32Array(this.heights));
		copy.revision = this.revision;
		return copy;
	}

	copyFrom(other: Heightfield): void {
		if (other.heights.length !== this.heights.length) throw new Error('Height grids differ in size.');
		this.heights.set(other.heights);
		this.revision++;
	}

	touch(): void {
		this.revision++;
	}

	fullRect(): GridRect {
		return { c0: 0, r0: 0, c1: this.cols - 1, r1: this.rows - 1 };
	}

	/** Vertex rectangle covering a world-space disc. */
	rectAround(x: number, z: number, radius: number): GridRect {
		return {
			c0: clamp(Math.floor(this.colAt(x - radius)), 0, this.cols - 1),
			r0: clamp(Math.floor(this.rowAt(z - radius)), 0, this.rows - 1),
			c1: clamp(Math.ceil(this.colAt(x + radius)), 0, this.cols - 1),
			r1: clamp(Math.ceil(this.rowAt(z + radius)), 0, this.rows - 1),
		};
	}
}
