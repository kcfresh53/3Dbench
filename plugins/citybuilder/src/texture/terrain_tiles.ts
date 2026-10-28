import packed from './terrain_tiles.json';
import type { Rgb } from '../core/raster';
import type { SurfaceName } from '../core/terrain/surfaces';
const tiles = new Map<string, Uint8Array>();
const aliases: Partial<Record<SurfaceName, string>> = { meadow: 'grass', mud: 'dirt', gravel: 'rock' };
/** Offline, world-space repeating albedo from CC0 ambientCG materials. */
export function terrainSample(name: SurfaceName, x: number, z: number, fallback: Rgb): Rgb {
	const key = aliases[name] ?? name;
	const source = (packed as Record<string, string>)[key];
	if (!source) return fallback;
	let pixels = tiles.get(key);
	if (!pixels) { pixels = Uint8Array.from(atob(source), c => c.charCodeAt(0)); tiles.set(key, pixels); }
	const u = ((Math.floor(x * 256 / 12) % 256) + 256) % 256;
	const v = ((Math.floor(z * 256 / 12) % 256) + 256) % 256;
	const offset = (v * 256 + u) * 3;
	const tint = name === 'meadow' ? [1.3, 1.12, 0.8] : name === 'mud' ? [0.65, 0.63, 0.6] : [1, 1, 1];
	return [pixels[offset] * tint[0], pixels[offset + 1] * tint[1], pixels[offset + 2] * tint[2]];
}
