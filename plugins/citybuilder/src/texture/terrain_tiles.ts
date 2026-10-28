import packed from './terrain_tiles.json';
import type { Rgb } from '../core/raster';
import type { SurfaceName } from '../core/terrain/surfaces';

const TILE_SIZE: number = 256;
/** World metres one tile repeats over. */
const TILE_METRES: number = 12;
const TEXELS_PER_METRE: number = TILE_SIZE / TILE_METRES;

const tiles: Map<string, Uint8Array> = new Map<string, Uint8Array>();
const aliases: Partial<Record<SurfaceName, string>> = { meadow: 'grass', mud: 'dirt', gravel: 'rock' };
const tints: Partial<Record<SurfaceName, Rgb>> = { meadow: [1.3, 1.12, 0.8], mud: [0.65, 0.63, 0.6] };
const NO_TINT: Rgb = [1, 1, 1];

/** A decoded tile and the tint applied to it, resolved once per surface. */
export interface TerrainTile {
	pixels: Uint8Array;
	tint: Rgb;
}

function decode(key: string): Uint8Array | null {
	const cached: Uint8Array | undefined = tiles.get(key);
	if (cached) return cached;
	const source: string | undefined = (packed as Record<string, string>)[key];
	if (!source) return null;
	const pixels: Uint8Array = Uint8Array.from(atob(source), (c: string): number => c.charCodeAt(0));
	tiles.set(key, pixels);
	return pixels;
}

/** Looks the tile of a surface up once, so per-pixel sampling needs no string or map work. */
export function terrainTile(name: SurfaceName): TerrainTile | null {
	const pixels: Uint8Array | null = decode(aliases[name] ?? name);
	return pixels ? { pixels, tint: tints[name] ?? NO_TINT } : null;
}

/** Index of the texel under a world position; the tile repeats every `TILE_METRES`. */
export function tileOffset(x: number, z: number): number {
	const u: number = ((Math.floor(x * TEXELS_PER_METRE) % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
	const v: number = ((Math.floor(z * TEXELS_PER_METRE) % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
	return (v * TILE_SIZE + u) * 3;
}

/** Offline, world-space repeating albedo from CC0 ambientCG materials. */
export function terrainSample(name: SurfaceName, x: number, z: number, fallback: Rgb): Rgb {
	const tile: TerrainTile | null = terrainTile(name);
	if (!tile) return fallback;
	const o: number = tileOffset(x, z);
	return [tile.pixels[o] * tile.tint[0], tile.pixels[o + 1] * tile.tint[1], tile.pixels[o + 2] * tile.tint[2]];
}
