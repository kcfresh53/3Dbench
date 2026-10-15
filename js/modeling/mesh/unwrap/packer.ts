import { Vec2 } from './types';

/** An island to pack: triangles as [u0, v0, u1, v1, u2, v2, ...] in arbitrary but consistent units. */
export interface PackItem {
	tris: Float64Array
}

export interface PackPlacement {
	/** Rotated by 90 degrees: (u, v) -> (v, -u) */
	rotated: boolean
	/** Final pixel position = rotate(uv) * scale + (tx, ty) */
	tx: number
	ty: number
}

export interface PackResult {
	scale: number
	placements: PackPlacement[]
	/** True when everything fit at the requested scale (fixed density mode) */
	fit_requested: boolean
}

export interface PackOptions {
	width: number
	height: number
	/** Gap between islands in pixels */
	margin: number
	allow_rotation: boolean
	/** Pixels per unit. 0 = find the largest scale that fits. */
	fixed_scale: number
}

export function rotateUV(u: number, v: number, rotated: boolean): Vec2 {
	return rotated ? [v, -u] : [u, v];
}

interface Mask {
	width: number
	height: number
	/** Occupied runs per row as [start, end) pairs, flattened */
	runs: Int32Array[]
	/** Offset of the raw (undilated) mask inside the dilated one */
	raw_cells: Uint8Array
	raw_width: number
	raw_height: number
}

interface ItemShape {
	/** Bounding box min per orientation, in units after rotation */
	min: [Vec2, Vec2]
	max: [Vec2, Vec2]
}

const MAX_GRID: number = 256;

export class AtlasPacker {
	private readonly cell: number;
	private readonly grid_w: number;
	private readonly grid_h: number;
	private readonly margin_cells: number;
	private shapes: ItemShape[] = [];

	constructor(private items: PackItem[], private options: PackOptions) {
		this.cell = Math.max(options.width, options.height) / Math.min(MAX_GRID, Math.max(options.width, options.height));
		this.grid_w = Math.max(1, Math.ceil(options.width / this.cell - 1e-9));
		this.grid_h = Math.max(1, Math.ceil(options.height / this.cell - 1e-9));
		this.margin_cells = Math.max(0, Math.ceil(options.margin / this.cell - 1e-9));
		this.shapes = items.map((item: PackItem) => this.computeShape(item));
	}

	private computeShape(item: PackItem): ItemShape {
		const min: [Vec2, Vec2] = [[Infinity, Infinity], [Infinity, Infinity]];
		const max: [Vec2, Vec2] = [[-Infinity, -Infinity], [-Infinity, -Infinity]];
		for (let i: number = 0; i < item.tris.length; i += 2) {
			const u: number = item.tris[i];
			const v: number = item.tris[i + 1];
			for (let o: number = 0; o < 2; o++) {
				const [x, y]: Vec2 = rotateUV(u, v, o == 1);
				min[o][0] = Math.min(min[o][0], x); min[o][1] = Math.min(min[o][1], y);
				max[o][0] = Math.max(max[o][0], x); max[o][1] = Math.max(max[o][1], y);
			}
		}
		return { min, max };
	}

	/** Total UV area of all islands, in units squared */
	totalArea(): number {
		let total: number = 0;
		for (const item of this.items) {
			for (let i: number = 0; i < item.tris.length; i += 6) {
				total += Math.abs((item.tris[i + 2] - item.tris[i]) * (item.tris[i + 5] - item.tris[i + 1]) - (item.tris[i + 4] - item.tris[i]) * (item.tris[i + 3] - item.tris[i + 1])) / 2;
			}
		}
		return total;
	}

	/** Conservatively rasterizes an island into grid cells at the given scale */
	private rasterize(index: number, rotated: boolean, scale: number): Mask | null {
		const item: PackItem = this.items[index];
		const o: number = rotated ? 1 : 0;
		const shape: ItemShape = this.shapes[index];
		const min_x: number = shape.min[o][0];
		const min_y: number = shape.min[o][1];
		const raw_w: number = Math.max(1, Math.ceil((shape.max[o][0] - min_x) * scale / this.cell - 1e-9));
		const raw_h: number = Math.max(1, Math.ceil((shape.max[o][1] - min_y) * scale / this.cell - 1e-9));
		const m: number = this.margin_cells;
		const width: number = raw_w + 2 * m;
		const height: number = raw_h + 2 * m;
		if (width > this.grid_w || height > this.grid_h) return null;

		const raw: Uint8Array = new Uint8Array(raw_w * raw_h);
		const to_cell = (value: number, minimum: number): number => (value - minimum) * scale / this.cell;
		for (let i: number = 0; i < item.tris.length; i += 6) {
			const px: number[] = [];
			const py: number[] = [];
			for (let k: number = 0; k < 3; k++) {
				const [x, y]: Vec2 = rotateUV(item.tris[i + k * 2], item.tris[i + k * 2 + 1], rotated);
				px.push(to_cell(x, min_x));
				py.push(to_cell(y, min_y));
			}
			const area2: number = (px[1] - px[0]) * (py[2] - py[0]) - (px[2] - px[0]) * (py[1] - py[0]);
			const sign: number = area2 < 0 ? -1 : 1;
			const x0: number = Math.max(0, Math.floor(Math.min(px[0], px[1], px[2])));
			const x1: number = Math.min(raw_w - 1, Math.floor(Math.max(px[0], px[1], px[2])));
			const y0: number = Math.max(0, Math.floor(Math.min(py[0], py[1], py[2])));
			const y1: number = Math.min(raw_h - 1, Math.floor(Math.max(py[0], py[1], py[2])));
			for (let cy: number = y0; cy <= y1; cy++) {
				for (let cx: number = x0; cx <= x1; cx++) {
					if (raw[cy * raw_w + cx]) continue;
					let outside: boolean = false;
					for (let k: number = 0; k < 3 && !outside; k++) {
						const ax: number = px[k], ay: number = py[k];
						const bx: number = px[(k + 1) % 3], by: number = py[(k + 1) % 3];
						// edge function sign * (point - a) x (b - a); pick the rect corner that is most inside
						const nx: number = -(by - ay) * sign;
						const ny: number = (bx - ax) * sign;
						const corner_x: number = nx > 0 ? cx + 1 : cx;
						const corner_y: number = ny > 0 ? cy + 1 : cy;
						if ((corner_x - ax) * nx + (corner_y - ay) * ny < 0) outside = true;
					}
					if (!outside || area2 == 0) raw[cy * raw_w + cx] = 1;
				}
			}
		}

		// square dilation by the margin, separable
		const dilated: Uint8Array = new Uint8Array(width * height);
		const horizontal: Uint8Array = new Uint8Array(width * raw_h);
		for (let y: number = 0; y < raw_h; y++) {
			for (let x: number = 0; x < raw_w; x++) {
				if (!raw[y * raw_w + x]) continue;
				for (let dx: number = 0; dx <= 2 * m; dx++) horizontal[y * width + x + dx] = 1;
			}
		}
		for (let y: number = 0; y < raw_h; y++) {
			for (let x: number = 0; x < width; x++) {
				if (!horizontal[y * width + x]) continue;
				for (let dy: number = 0; dy <= 2 * m; dy++) dilated[(y + dy) * width + x] = 1;
			}
		}
		const runs: Int32Array[] = [];
		for (let y: number = 0; y < height; y++) {
			const row: number[] = [];
			let start: number = -1;
			for (let x: number = 0; x <= width; x++) {
				const set: boolean = x < width && dilated[y * width + x] == 1;
				if (set && start < 0) start = x;
				if (!set && start >= 0) {
					row.push(start, x);
					start = -1;
				}
			}
			runs.push(Int32Array.from(row));
		}
		return { width, height, runs, raw_cells: raw, raw_width: raw_w, raw_height: raw_h };
	}

	/** Tries to place all islands at a scale. Returns null if they do not fit. */
	private tryPack(scale: number, order: number[]): PackPlacement[] | null {
		const gw: number = this.grid_w;
		const gh: number = this.grid_h;
		// prefix[y][x] = number of occupied cells in row y left of x
		const prefix: Int32Array[] = [];
		for (let y: number = 0; y < gh; y++) prefix.push(new Int32Array(gw + 1));
		const placements: PackPlacement[] = new Array(this.items.length);
		const m: number = this.margin_cells;

		for (const index of order) {
			let best: {mask: Mask, rotated: boolean, x: number, y: number} | null = null;
			const orientations: boolean[] = this.options.allow_rotation ? [false, true] : [false];
			for (const rotated of orientations) {
				const mask: Mask | null = this.rasterize(index, rotated, scale);
				if (!mask) continue;
				const found: {x: number, y: number} | null = this.findSpot(mask, prefix, best ? best.y + best.mask.height : gh);
				if (!found) continue;
				if (!best || found.y + mask.height < best.y + best.mask.height ||
					(found.y + mask.height == best.y + best.mask.height && found.x < best.x)) {
					best = { mask, rotated, x: found.x, y: found.y };
				}
			}
			if (!best) return null;
			// occupy the raw cells
			const mask: Mask = best.mask;
			for (let ry: number = 0; ry < mask.raw_height; ry++) {
				const row: Int32Array = prefix[best.y + m + ry];
				const occupied: Uint8Array = new Uint8Array(gw);
				for (let x: number = 0; x < gw; x++) occupied[x] = row[x + 1] - row[x] > 0 ? 1 : 0;
				for (let rx: number = 0; rx < mask.raw_width; rx++) {
					if (mask.raw_cells[ry * mask.raw_width + rx]) occupied[best.x + m + rx] = 1;
				}
				for (let x: number = 0; x < gw; x++) row[x + 1] = row[x] + occupied[x];
			}
			const o: number = best.rotated ? 1 : 0;
			const shape: ItemShape = this.shapes[index];
			placements[index] = {
				rotated: best.rotated,
				tx: (best.x + m) * this.cell - shape.min[o][0] * scale,
				ty: (best.y + m) * this.cell - shape.min[o][1] * scale,
			};
		}
		return placements;
	}

	private findSpot(mask: Mask, prefix: Int32Array[], y_limit: number): {x: number, y: number} | null {
		const max_x: number = this.grid_w - mask.width;
		const max_y: number = Math.min(this.grid_h - mask.height, y_limit);
		for (let y: number = 0; y <= max_y; y++) {
			for (let x: number = 0; x <= max_x; x++) {
				let free: boolean = true;
				for (let row: number = 0; row < mask.height && free; row++) {
					const runs: Int32Array = mask.runs[row];
					const p: Int32Array = prefix[y + row];
					for (let r: number = 0; r < runs.length; r += 2) {
						if (p[x + runs[r + 1]] - p[x + runs[r]] > 0) {
							free = false;
							break;
						}
					}
				}
				if (free) return { x, y };
			}
		}
		return null;
	}

	pack(): PackResult {
		const count: number = this.items.length;
		if (count == 0) return { scale: 1, placements: [], fit_requested: true };
		// large islands first, they are the hardest to place
		const order: number[] = this.items.map((_: PackItem, i: number) => i).sort((a: number, b: number) => {
			const size = (i: number): number => Math.max(
				this.shapes[i].max[0][0] - this.shapes[i].min[0][0],
				this.shapes[i].max[0][1] - this.shapes[i].min[0][1]
			);
			return size(b) - size(a);
		});

		const atlas_area: number = this.options.width * this.options.height;
		const total: number = this.totalArea();
		if (this.options.fixed_scale > 0) {
			let scale: number = this.options.fixed_scale;
			const requested: PackPlacement[] | null = this.tryPack(scale, order);
			if (requested) return { scale, placements: requested, fit_requested: true };
			for (let i: number = 0; i < 60; i++) {
				scale *= 0.92;
				const placements: PackPlacement[] | null = this.tryPack(scale, order);
				if (placements) return { scale, placements, fit_requested: false };
			}
			return { scale, placements: this.fallbackPlacements(scale), fit_requested: false };
		}

		let scale: number = Math.sqrt(0.55 * atlas_area / Math.max(total, 1e-12));
		let best: {scale: number, placements: PackPlacement[]} | null = null;
		let failed_scale: number = Infinity;
		let placements: PackPlacement[] | null = this.tryPack(scale, order);
		if (placements) {
			best = { scale, placements };
			for (let i: number = 0; i < 16; i++) {
				const next: number = scale * 1.12;
				const result: PackPlacement[] | null = this.tryPack(next, order);
				if (!result) { failed_scale = next; break; }
				best = { scale: next, placements: result };
				scale = next;
			}
		} else {
			failed_scale = scale;
			for (let i: number = 0; i < 80 && !best; i++) {
				scale *= 0.9;
				const result: PackPlacement[] | null = this.tryPack(scale, order);
				if (result) best = { scale, placements: result };
				else failed_scale = scale;
			}
		}
		if (!best) return { scale, placements: this.fallbackPlacements(scale), fit_requested: false };
		for (let i: number = 0; i < 5 && isFinite(failed_scale); i++) {
			const mid: number = (best.scale + failed_scale) / 2;
			const result: PackPlacement[] | null = this.tryPack(mid, order);
			if (result) best = { scale: mid, placements: result };
			else failed_scale = mid;
		}
		return { scale: best.scale, placements: best.placements, fit_requested: true };
	}

	/** Last resort when nothing fits: stack islands at the origin */
	private fallbackPlacements(scale: number): PackPlacement[] {
		return this.items.map((_: PackItem, i: number) => ({
			rotated: false,
			tx: -this.shapes[i].min[0][0] * scale,
			ty: -this.shapes[i].min[0][1] * scale,
		}));
	}
}
