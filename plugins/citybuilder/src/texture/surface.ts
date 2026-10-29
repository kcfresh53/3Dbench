import { Raster } from '../core/raster';
import type { Rgb } from '../core/raster';

/** One surface sample while a tile is being painted. Colours are 0..255, the rest are 0..1 except height. */
export interface Texel {
	r: number;
	g: number;
	b: number;
	roughness: number;
	metallic: number;
	/** Baked ambient occlusion (1 = open). */
	ao: number;
	/** Relief in metres; the normal map is derived from it. */
	height: number;
	/** Extra surface tilt from a photographic normal map, added to the slope of `height`. */
	slopeX: number;
	slopeY: number;
}

export function resetTexel(t: Texel, color: Rgb, roughness: number, metallic: number): void {
	t.r = color[0];
	t.g = color[1];
	t.b = color[2];
	t.roughness = roughness;
	t.metallic = metallic;
	t.ao = 1;
	t.height = 0;
	t.slopeX = 0;
	t.slopeY = 0;
}

/**
 * Lays a material over what is already there. `cover` is the anti-aliased coverage (0..1), so shape edges are
 * smooth at any resolution. `height` is absolute relief in metres where the layer is fully covering.
 */
export function layer(t: Texel, cover: number, color: Rgb, roughness: number, metallic: number, height: number = 0): void {
	if (cover <= 0) return;
	const c: number = Math.min(1, cover);
	t.r += (color[0] - t.r) * c;
	t.g += (color[1] - t.g) * c;
	t.b += (color[2] - t.b) * c;
	t.roughness += (roughness - t.roughness) * c;
	t.metallic += (metallic - t.metallic) * c;
	t.height += (height - t.height) * c;
	t.slopeX -= t.slopeX * c;
	t.slopeY -= t.slopeY * c;
}

/** Darkens ambient occlusion by `amount` (0..1) with the given strength. */
export function occlude(t: Texel, amount: number): void {
	if (amount > 0) t.ao *= 1 - Math.min(1, amount);
}

/** Anti-aliased coverage of a signed distance (metres, negative inside) for a pixel of `pixel` metres. */
export function coverage(distance: number, pixel: number): number {
	const c: number = 0.5 - distance / pixel;
	return c <= 0 ? 0 : c >= 1 ? 1 : c;
}

/** Signed distance to an axis-aligned rectangle given by its edges. */
export function boxDistance(x: number, y: number, x0: number, y0: number, x1: number, y1: number): number {
	const cx: number = (x0 + x1) / 2;
	const cy: number = (y0 + y1) / 2;
	const dx: number = Math.abs(x - cx) - (x1 - x0) / 2;
	const dy: number = Math.abs(y - cy) - (y1 - y0) / 2;
	return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
}

/** The three maps of a PBR surface, all the same size. ORM is R = occlusion, G = roughness, B = metallic. */
export class SurfaceMaps {
	readonly albedo: Raster;
	readonly orm: Raster;
	readonly normal: Raster;

	constructor(
		readonly width: number,
		readonly height: number,
	) {
		this.albedo = new Raster(width, height);
		this.orm = new Raster(width, height);
		this.normal = new Raster(width, height);
	}

	/** Writes a painted texel at a pixel; height is kept aside by the caller for `bakeNormals`. */
	write(x: number, y: number, t: Texel): void {
		this.albedo.set(x, y, [t.r, t.g, t.b]);
		this.orm.set(x, y, [t.ao * 255, t.roughness * 255, t.metallic * 255]);
	}

	paste(source: SurfaceMaps, dx: number, dy: number): void {
		this.albedo.paste(source.albedo, dx, dy);
		this.orm.paste(source.orm, dx, dy);
		this.normal.paste(source.normal, dx, dy);
	}

	/** Fills the whole surface with a flat default (mid grey, rough, non-metal, flat normal). */
	clear(color: Rgb): void {
		this.albedo.fill(color);
		this.orm.fill([255, 200, 0]);
		this.normal.fill([128, 128, 255]);
	}
}

/**
 * Turns a height field (metres, one value per pixel) into a tangent-space normal map. `slopes` holds extra x/y tilt per pixel. Green points to the top of the
 * image, which is how glTF and most engines read normal maps. `pixelX` and `pixelY` are the size of one texel in metres.
 */
export function bakeNormals(maps: SurfaceMaps, heights: Float32Array, slopes: Float32Array, pixelX: number, pixelY: number, strength: number = 1): void {
	const w: number = maps.width;
	const h: number = maps.height;
	const at = (x: number, y: number): number => heights[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
	const invX: number = strength / (2 * pixelX);
	const invY: number = strength / (2 * pixelY);
	for (let y: number = 0; y < h; y++) {
		for (let x: number = 0; x < w; x++) {
			const k: number = (y * w + x) * 2;
			const nx: number = -(at(x + 1, y) - at(x - 1, y)) * invX + slopes[k];
			const ny: number = (at(x, y + 1) - at(x, y - 1)) * invY + slopes[k + 1];
			const len: number = Math.hypot(nx, ny, 1);
			maps.normal.set(x, y, [(nx / len) * 127.5 + 127.5, (ny / len) * 127.5 + 127.5, (1 / len) * 127.5 + 127.5]);
		}
	}
}

/** Copies edge pixels of a rectangle outward by `gutter` pixels in every map, so filtering never reads a neighbour. */
export function extrudeMaps(maps: SurfaceMaps, x: number, y: number, w: number, h: number, gutter: number): void {
	for (const raster of [maps.albedo, maps.orm, maps.normal]) {
		for (let g: number = 1; g <= gutter; g++) {
			for (let i: number = -g + 1; i < w + g; i++) {
				const sx: number = Math.min(w - 1, Math.max(0, i));
				raster.set(x + i, y - g, raster.get(x + sx, y));
				raster.set(x + i, y + h - 1 + g, raster.get(x + sx, y + h - 1));
			}
			for (let j: number = -g; j < h + g; j++) {
				const sy: number = Math.min(h - 1, Math.max(0, j));
				raster.set(x - g, y + sy, raster.get(x, y + sy));
				raster.set(x + w - 1 + g, y + sy, raster.get(x + w - 1, y + sy));
			}
		}
	}
}
