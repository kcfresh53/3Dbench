import type { GridRect } from './types';

/** A rectangular grid of unsigned bytes, for per-cell data such as districts and painted surfaces. */
export class ByteGrid {
	readonly data: Uint8Array;

	constructor(
		readonly cols: number,
		readonly rows: number,
		fill: number = 0,
	) {
		this.data = new Uint8Array(cols * rows);
		if (fill !== 0) this.data.fill(fill);
	}

	static from(cols: number, rows: number, data: Uint8Array): ByteGrid {
		const grid: ByteGrid = new ByteGrid(cols, rows);
		grid.data.set(data.subarray(0, cols * rows));
		return grid;
	}

	inside(c: number, r: number): boolean {
		return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
	}

	get(c: number, r: number): number {
		return this.inside(c, r) ? this.data[r * this.cols + c] : 0;
	}

	set(c: number, r: number, value: number): void {
		if (this.inside(c, r)) this.data[r * this.cols + c] = value;
	}

	fill(value: number, rect?: GridRect): void {
		if (!rect) {
			this.data.fill(value);
			return;
		}
		for (let r: number = Math.max(0, rect.r0); r <= Math.min(this.rows - 1, rect.r1); r++) {
			for (let c: number = Math.max(0, rect.c0); c <= Math.min(this.cols - 1, rect.c1); c++) this.data[r * this.cols + c] = value;
		}
	}

	clone(): ByteGrid {
		return ByteGrid.from(this.cols, this.rows, this.data);
	}

	count(value: number): number {
		let total: number = 0;
		for (let i: number = 0; i < this.data.length; i++) if (this.data[i] === value) total++;
		return total;
	}
}

/** Uniform spatial hash over the XZ plane for fast overlap queries. */
export class SpatialHash<T> {
	private readonly buckets: Map<number, T[]> = new Map();

	constructor(private readonly cell: number) {}

	private key(ix: number, iz: number): number {
		return (ix + 32768) * 65536 + (iz + 32768);
	}

	insert(item: T, minX: number, minZ: number, maxX: number, maxZ: number): void {
		const x0: number = Math.floor(minX / this.cell);
		const x1: number = Math.floor(maxX / this.cell);
		const z0: number = Math.floor(minZ / this.cell);
		const z1: number = Math.floor(maxZ / this.cell);
		for (let ix: number = x0; ix <= x1; ix++) {
			for (let iz: number = z0; iz <= z1; iz++) {
				const k: number = this.key(ix, iz);
				const list: T[] | undefined = this.buckets.get(k);
				if (list) list.push(item);
				else this.buckets.set(k, [item]);
			}
		}
	}

	/** Distinct items whose buckets touch the rectangle. */
	query(minX: number, minZ: number, maxX: number, maxZ: number): T[] {
		const seen: Set<T> = new Set();
		const x0: number = Math.floor(minX / this.cell);
		const x1: number = Math.floor(maxX / this.cell);
		const z0: number = Math.floor(minZ / this.cell);
		const z1: number = Math.floor(maxZ / this.cell);
		for (let ix: number = x0; ix <= x1; ix++) {
			for (let iz: number = z0; iz <= z1; iz++) {
				const list: T[] | undefined = this.buckets.get(this.key(ix, iz));
				if (list) for (const item of list) seen.add(item);
			}
		}
		return [...seen];
	}
}
