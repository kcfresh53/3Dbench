import { ATLAS_PX, PALETTES, TILE_KINDS, TILE_PX } from '../core/buildings/tiles';
import type { Palette, TileKind } from '../core/buildings/tiles';
import { tileRect } from '../core/buildings/tiles';
import { hash2 } from '../core/math';
import { Raster } from '../core/raster';

type Rgb = [number, number, number];

const mul = (c: Rgb, f: number): Rgb => [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function speckle(r: Raster, color: Rgb, seed: number, amount: number): void {
	for (let y: number = 0; y < r.height; y++) {
		for (let x: number = 0; x < r.width; x++) {
			const n: number = (hash2(x, y, seed) - 0.5) * amount;
			const c: Rgb = r.get(x, y);
			r.set(x, y, [c[0] + n, c[1] + n, c[2] + n]);
		}
	}
	void color;
}

function window(r: Raster, p: Palette, x: number, y: number, w: number, h: number): void {
	r.rect(x - 1, y - 1, w + 2, h + 2, p.frame);
	for (let j: number = 0; j < h; j++) {
		const t: number = j / Math.max(1, h - 1);
		r.rect(x, y + j, w, 1, mix(mul(p.glass, 1.25), mul(p.glass, 0.7), t));
	}
	r.rect(x + Math.floor(w / 2), y, 1, h, p.frame);
	r.rect(x, y + h - 1, w, 1, mul(p.trim, 0.9));
}

function brickBase(r: Raster, p: Palette, base: Rgb, seed: number): void {
	r.fill(base);
	for (let y: number = 0; y < r.height; y += 4) {
		r.rect(0, y, r.width, 1, mul(base, 0.82));
		const offset: number = (y / 4) % 2 === 0 ? 0 : 4;
		for (let x: number = offset; x < r.width; x += 8) r.rect(x, y, 1, 4, mul(base, 0.86));
	}
	speckle(r, base, seed, 10);
	void p;
}

/** Paints one tile of one palette into a TILE_PX square raster. */
export function paintTile(kind: TileKind, paletteIndex: number): Raster {
	const p: Palette = PALETTES[paletteIndex % PALETTES.length];
	const r: Raster = new Raster(TILE_PX, TILE_PX);
	const seed: number = TILE_KINDS.indexOf(kind) * 31 + paletteIndex;
	const S: number = TILE_PX;
	switch (kind) {
		case 'wall':
			r.fill(p.wall);
			speckle(r, p.wall, seed, 12);
			r.rect(0, S - 2, S, 2, mul(p.wall, 0.88));
			break;
		case 'brick':
			brickBase(r, p, p.wall, seed);
			break;
		case 'window':
			r.fill(p.wall);
			speckle(r, p.wall, seed, 12);
			window(r, p, 9, 6, 14, 18);
			r.rect(7, 25, 18, 2, p.trim);
			break;
		case 'window_wide':
			r.fill(p.wall);
			speckle(r, p.wall, seed, 12);
			window(r, p, 4, 8, 24, 14);
			r.rect(2, 23, 28, 2, p.trim);
			break;
		case 'window_pair':
			r.fill(p.wall);
			speckle(r, p.wall, seed, 12);
			window(r, p, 4, 6, 10, 18);
			window(r, p, 18, 6, 10, 18);
			r.rect(2, 25, 28, 2, p.trim);
			break;
		case 'balcony':
			r.fill(p.wall);
			speckle(r, p.wall, seed, 12);
			window(r, p, 9, 3, 14, 16);
			r.rect(3, 21, 26, 2, p.trim);
			for (let x: number = 4; x < 29; x += 4) r.rect(x, 23, 1, 7, p.frame);
			r.rect(3, 29, 26, 2, p.frame);
			break;
		case 'shop_glass':
			r.fill(mul(p.frame, 1.2));
			for (let j: number = 4; j < 28; j++) r.rect(3, j, 26, 1, mix(mul(p.glass, 1.35), mul(p.glass, 0.75), (j - 4) / 24));
			r.rect(15, 4, 2, 24, p.frame);
			r.rect(0, 0, S, 3, p.trim);
			r.rect(0, 28, S, 4, mul(p.wall, 0.8));
			break;
		case 'shop_door':
			r.fill(mul(p.frame, 1.2));
			r.rect(6, 4, 20, 26, p.accent);
			for (let j: number = 7; j < 22; j++) r.rect(9, j, 14, 1, mix(mul(p.glass, 1.35), mul(p.glass, 0.75), (j - 7) / 15));
			r.rect(21, 20, 2, 3, p.trim);
			r.rect(0, 0, S, 3, p.trim);
			break;
		case 'door':
			r.fill(p.wall);
			speckle(r, p.wall, seed, 12);
			r.rect(8, 6, 16, 26, p.frame);
			r.rect(10, 8, 12, 24, p.accent);
			r.rect(19, 19, 2, 2, p.trim);
			r.rect(6, 4, 20, 2, p.trim);
			break;
		case 'garage':
			r.fill(mul(p.wall, 0.95));
			r.rect(3, 6, 26, 26, mul(p.trim, 0.9));
			for (let y: number = 8; y < 32; y += 4) r.rect(3, y, 26, 1, mul(p.trim, 0.65));
			break;
		case 'panel':
			r.fill(p.wall);
			for (let x: number = 0; x < S; x += 4) r.rect(x, 0, 1, S, mul(p.wall, 0.82));
			speckle(r, p.wall, seed, 8);
			r.rect(0, S - 4, S, 4, mul(p.wall, 0.7));
			break;
		case 'panel_high':
			r.fill(p.wall);
			for (let x: number = 0; x < S; x += 4) r.rect(x, 0, 1, S, mul(p.wall, 0.82));
			speckle(r, p.wall, seed, 8);
			for (let x: number = 3; x < S - 6; x += 10) {
				for (let j: number = 4; j < 10; j++) r.rect(x, j, 7, 1, mix(mul(p.glass, 1.3), mul(p.glass, 0.8), (j - 4) / 6));
			}
			break;
		case 'curtain':
			for (let y: number = 0; y < S; y++) for (let x: number = 0; x < S; x++) r.set(x, y, mix(mul(p.glass, 1.3), mul(p.glass, 0.7), (y + x * 0.4) / (S * 1.4)));
			for (let x: number = 0; x < S; x += 8) r.rect(x, 0, 1, S, p.frame);
			r.rect(0, S - 2, S, 2, p.frame);
			break;
		case 'curtain_band':
			r.fill(p.trim);
			r.rect(0, 0, S, 2, mul(p.trim, 1.2));
			for (let x: number = 0; x < S; x += 8) r.rect(x, 0, 1, S, mul(p.trim, 0.8));
			break;
		case 'roof_flat':
			r.fill(mul(p.roof, 1.1));
			speckle(r, p.roof, seed, 22);
			r.rect(0, 0, S, 1, mul(p.roof, 0.7));
			r.rect(0, S - 1, S, 1, mul(p.roof, 0.7));
			break;
		case 'roof_tile':
			r.fill(p.roof);
			for (let y: number = 0; y < S; y += 4) r.rect(0, y, S, 1, mul(p.roof, 0.72));
			for (let y: number = 0; y < S; y += 4) for (let x: number = (y / 4) % 2 === 0 ? 0 : 4; x < S; x += 8) r.rect(x, y, 1, 4, mul(p.roof, 0.82));
			speckle(r, p.roof, seed, 14);
			break;
		case 'roof_metal':
			r.fill(mul(p.roof, 1.15));
			for (let x: number = 0; x < S; x += 5) {
				r.rect(x, 0, 1, S, mul(p.roof, 0.75));
				r.rect(x + 1, 0, 1, S, mul(p.roof, 1.3));
			}
			break;
		case 'trim':
			r.fill(p.trim);
			r.rect(0, 0, S, 3, mul(p.trim, 1.15));
			r.rect(0, S - 3, S, 3, mul(p.trim, 0.78));
			speckle(r, p.trim, seed, 8);
			break;
		case 'plinth':
			r.fill(mul(p.trim, 0.55));
			speckle(r, p.trim, seed, 14);
			break;
		case 'metal':
			r.fill(mix(p.frame, [150, 154, 158], 0.55));
			for (let y: number = 0; y < S; y += 6) r.rect(0, y, S, 1, mul(p.frame, 0.9));
			speckle(r, p.frame, seed, 10);
			break;
		case 'awning':
			for (let x: number = 0; x < S; x++) r.rect(x, 0, 1, S, Math.floor(x / 4) % 2 === 0 ? p.accent : mix(p.accent, [240, 240, 236], 0.8));
			r.rect(0, S - 3, S, 3, mul(p.accent, 0.7));
			break;
		case 'sign':
			r.fill(p.frame);
			r.rect(2, 8, S - 4, S - 16, p.accent);
			r.rect(5, 12, S - 10, 3, p.trim);
			r.rect(5, 18, S - 16, 2, p.trim);
			break;
	}
	return r;
}

let cachedAtlas: Raster | null = null;
const cachedTiles: Map<string, Raster> = new Map();

/** Memoised single tile, shared by the atlas painter and the facade baker. */
export function tileRaster(kind: TileKind, palette: number): Raster {
	const key: string = `${kind}:${palette}`;
	let raster: Raster | undefined = cachedTiles.get(key);
	if (!raster) {
		raster = paintTile(kind, palette);
		cachedTiles.set(key, raster);
	}
	return raster;
}

/** The full 512 px modular tile atlas (every kind in every palette). */
export function paintBuildingAtlas(): Raster {
	if (cachedAtlas) return cachedAtlas;
	const atlas: Raster = new Raster(ATLAS_PX, ATLAS_PX);
	atlas.fill([255, 0, 255]);
	TILE_KINDS.forEach((kind: TileKind, kindIndex: number): void => {
		for (let palette: number = 0; palette < PALETTES.length; palette++) {
			const ref: number = kindIndex * PALETTES.length + palette;
			const rect = tileRect(ref);
			atlas.blit(tileRaster(kind, palette), 0, 0, TILE_PX, TILE_PX, rect.x, rect.y, TILE_PX, TILE_PX);
		}
	});
	cachedAtlas = atlas;
	return atlas;
}

export { Raster };
