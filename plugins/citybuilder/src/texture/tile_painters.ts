import { NOMINAL_TILE_M, PALETTES, TILE_KINDS, TILE_PX } from '../core/buildings/tiles';
import type { Palette, PixelRect, TileKind, TileRef } from '../core/buildings/tiles';
import type { Vec2 } from '../core/types';
import { tileKind, tilePalette } from '../core/buildings/tiles';
import { paintPoint } from './facade_painters';
import type { TileCtx } from './facade_painters';
import { bakeNormals, extrudeMaps, SurfaceMaps } from './surface';
import type { Texel } from './surface';

/**
 * Paints one surface pattern at any resolution. The pattern is described in metres, so a larger raster simply
 * shows more detail instead of bigger pixels; edges are anti-aliased analytically.
 *
 * @param mw world width the tile covers (a bay), @param mh world height (a storey)
 * @param seed picks the small per-window variations
 */
export function paintSurface(kind: TileKind, paletteIndex: number, width: number, height: number, mw: number, mh: number, seed: number): SurfaceMaps {
	const p: Palette = PALETTES[((paletteIndex % PALETTES.length) + PALETTES.length) % PALETTES.length];
	const maps: SurfaceMaps = new SurfaceMaps(width, height);
	const heights: Float32Array = new Float32Array(width * height);
	const slopes: Float32Array = new Float32Array(width * height * 2);
	const pixelX: number = mw / width;
	const pixelY: number = mh / height;
	const ctx: TileCtx = { p, mw, mh, pixel: Math.max(pixelX, pixelY), seed: seed + TILE_KINDS.indexOf(kind) * 31 + paletteIndex };
	const texel: Texel = { r: 128, g: 128, b: 128, roughness: 0.8, metallic: 0, ao: 1, height: 0, slopeX: 0, slopeY: 0 };
	for (let j: number = 0; j < height; j++) {
		const y: number = (j + 0.5) * pixelY;
		for (let i: number = 0; i < width; i++) {
			paintPoint(kind, ctx, texel, (i + 0.5) * pixelX, y);
			maps.write(i, j, texel);
			heights[j * width + i] = texel.height;
			slopes[(j * width + i) * 2] = texel.slopeX;
			slopes[(j * width + i) * 2 + 1] = texel.slopeY;
		}
	}
	bakeNormals(maps, heights, slopes, pixelX, pixelY);
	return maps;
}

/** Pixels trimmed from each tile edge so filtering and mip levels never reach a neighbour. */
const INSET_PX: number = 2;
const START_PX: number = 2048;

/**
 * The modular tile atlas for the live view. Tiles take the next free slot the first time something needs
 * them and are painted then, so a city only pays for the looks it uses. The atlas doubles in size if a city
 * needs more than fit.
 */
export class TileAtlas {
	maps: SurfaceMaps = new SurfaceMaps(START_PX, START_PX);
	private readonly slots: Map<TileRef, number> = new Map<TileRef, number>();
	/** Bumped whenever tiles were added or the atlas grew, so a texture knows to re-upload. */
	version: number = 0;

	constructor() {
		this.maps.clear([196, 196, 196]);
	}

	get size(): number {
		return this.maps.width;
	}

	private get perRow(): number {
		return this.size / TILE_PX;
	}

	private rectOf(slot: number): PixelRect {
		return { x: (slot % this.perRow) * TILE_PX, y: Math.floor(slot / this.perRow) * TILE_PX, w: TILE_PX, h: TILE_PX };
	}

	private paint(ref: TileRef, slot: number): void {
		const rect: PixelRect = this.rectOf(slot);
		this.maps.paste(paintSurface(tileKind(ref), tilePalette(ref), TILE_PX, TILE_PX, NOMINAL_TILE_M[0], NOMINAL_TILE_M[1], 0), rect.x, rect.y);
		extrudeMaps(this.maps, rect.x, rect.y, rect.w, rect.h, 3);
	}

	/** Gives every one of these tiles a slot and paints the new ones. Returns whether anything changed. */
	ensure(refs: Iterable<TileRef>): boolean {
		let changed: boolean = false;
		for (const ref of refs) {
			if (this.slots.has(ref)) continue;
			if (this.slots.size >= this.perRow * this.perRow) this.grow();
			const slot: number = this.slots.size;
			this.slots.set(ref, slot);
			this.paint(ref, slot);
			changed = true;
		}
		if (changed) this.version++;
		return changed;
	}

	private grow(): void {
		this.maps = new SurfaceMaps(this.size * 2, this.size * 2);
		this.maps.clear([196, 196, 196]);
		for (const [ref, slot] of this.slots) this.paint(ref, slot);
	}

	/** Atlas UV (0..1, origin top-left) for a point (u, v) inside a tile; v grows downward. */
	uv(ref: TileRef, u: number, v: number): Vec2 {
		const slot: number | undefined = this.slots.get(ref);
		if (slot === undefined) throw new Error(`Tile ${ref} was not prepared`);
		const rect: PixelRect = this.rectOf(slot);
		const span: number = TILE_PX - 2 * INSET_PX;
		return [(rect.x + INSET_PX + u * span) / this.size, (rect.y + INSET_PX + v * span) / this.size];
	}
}

let shared: TileAtlas | null = null;

/** The one atlas shared by every view. */
export function sharedTileAtlas(): TileAtlas {
	shared ??= new TileAtlas();
	return shared;
}
