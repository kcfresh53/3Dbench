/** Tiny CPU raster used for textures. Nothing here needs a canvas, so it runs in Node tests too. */
export type Rgb = [number, number, number];

/** A square RGBA raster. No canvas is needed, so painting runs in Node tests and in the editor alike. */
export class Raster {
	readonly data: Uint8ClampedArray;

	constructor(
		readonly width: number,
		readonly height: number,
	) {
		this.data = new Uint8ClampedArray(width * height * 4);
	}

	set(x: number, y: number, color: Rgb, alpha: number = 255): void {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
		const i: number = (y * this.width + x) * 4;
		this.data[i] = color[0];
		this.data[i + 1] = color[1];
		this.data[i + 2] = color[2];
		this.data[i + 3] = alpha;
	}

	get(x: number, y: number): Rgb {
		const i: number = (Math.max(0, Math.min(this.height - 1, y)) * this.width + Math.max(0, Math.min(this.width - 1, x))) * 4;
		return [this.data[i], this.data[i + 1], this.data[i + 2]];
	}

	rect(x: number, y: number, w: number, h: number, color: Rgb): void {
		for (let j: number = 0; j < h; j++) for (let i: number = 0; i < w; i++) this.set(x + i, y + j, color);
	}

	fill(color: Rgb): void {
		this.rect(0, 0, this.width, this.height, color);
	}

	/** Copies a block of another raster, resampling with nearest neighbour. */
	blit(source: Raster, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void {
		for (let j: number = 0; j < dh; j++) {
			for (let i: number = 0; i < dw; i++) {
				const px: number = sx + Math.min(sw - 1, Math.floor(((i + 0.5) * sw) / dw));
				const py: number = sy + Math.min(sh - 1, Math.floor(((j + 0.5) * sh) / dh));
				this.set(dx + i, dy + j, source.get(px, py));
			}
		}
	}
}
