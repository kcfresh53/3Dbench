/**
 * Tileable textures for the water preview, generated on the CPU so the plugin ships no image files and
 * the maps repeat without seams. Each function returns RGBA bytes for a square texture.
 */

function hash(x: number, y: number, seed: number): number {
	let h: number = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise on a lattice that wraps every `period` cells, so the result tiles. */
function periodicNoise(x: number, y: number, period: number, seed: number): number {
	const x0: number = Math.floor(x);
	const y0: number = Math.floor(y);
	const fx: number = x - x0;
	const fy: number = y - y0;
	const ux: number = fx * fx * (3 - 2 * fx);
	const uy: number = fy * fy * (3 - 2 * fy);
	const at = (i: number, j: number): number => hash(((i % period) + period) % period, ((j % period) + period) % period, seed);
	const top: number = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * ux;
	const bottom: number = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * ux;
	return top + (bottom - top) * uy;
}

/** Fractal noise in 0..1 that tiles over `size` texels. */
export function tileableFbm(size: number, seed: number, cells: number, octaves: number): Float32Array {
	const out: Float32Array = new Float32Array(size * size);
	let norm: number = 0;
	for (let o: number = 0; o < octaves; o++) norm += Math.pow(0.5, o);
	for (let j: number = 0; j < size; j++) {
		for (let i: number = 0; i < size; i++) {
			let sum: number = 0;
			for (let o: number = 0; o < octaves; o++) {
				const period: number = cells * (1 << o);
				sum += periodicNoise((i / size) * period, (j / size) * period, period, seed + o * 17) * Math.pow(0.5, o);
			}
			out[j * size + i] = sum / norm;
		}
	}
	return out;
}

/** Ripple normal map (tangent space, 0..255 per channel): neighbouring heights give the slope, wrapping at the edges. */
export function rippleNormals(size: number, seed: number, cells: number): Uint8Array {
	const height: Float32Array = tileableFbm(size, seed, cells, 4);
	const out: Uint8Array = new Uint8Array(size * size * 4);
	const strength: number = 5;
	const at = (i: number, j: number): number => height[((j + size) % size) * size + ((i + size) % size)];
	for (let j: number = 0; j < size; j++) {
		for (let i: number = 0; i < size; i++) {
			const dx: number = (at(i + 1, j) - at(i - 1, j)) * strength;
			const dy: number = (at(i, j + 1) - at(i, j - 1)) * strength;
			const l: number = Math.hypot(dx, dy, 1);
			const o: number = (j * size + i) * 4;
			out[o] = Math.round(((-dx / l) * 0.5 + 0.5) * 255);
			out[o + 1] = Math.round(((-dy / l) * 0.5 + 0.5) * 255);
			out[o + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
			out[o + 3] = 255;
		}
	}
	return out;
}

/** Sun glitter: mostly dark with bright flecks, the same in every colour channel. */
export function glitterTexture(size: number, seed: number, cells: number): Uint8Array {
	const noise: Float32Array = tileableFbm(size, seed, cells, 3);
	const out: Uint8Array = new Uint8Array(size * size * 4);
	for (let i: number = 0; i < size * size; i++) {
		const v: number = Math.max(0, (noise[i] - 0.52) / 0.48);
		const value: number = Math.round(Math.min(1, v * v * 3.2 + 0.18) * 255);
		out[i * 4] = value;
		out[i * 4 + 1] = value;
		out[i * 4 + 2] = value;
		out[i * 4 + 3] = 255;
	}
	return out;
}

/** Foam: white where fractal noise is high, with that noise as the opacity. */
export function foamTexture(size: number, seed: number, cells: number): Uint8Array {
	const noise: Float32Array = tileableFbm(size, seed, cells, 4);
	const out: Uint8Array = new Uint8Array(size * size * 4);
	for (let i: number = 0; i < size * size; i++) {
		const v: number = Math.min(1, Math.max(0, (noise[i] - 0.45) / 0.3));
		out[i * 4] = 255;
		out[i * 4 + 1] = 255;
		out[i * 4 + 2] = 255;
		out[i * 4 + 3] = Math.round(v * v * (3 - 2 * v) * 255);
	}
	return out;
}

export interface WaterTextureSet {
	size: number;
	normal1: Uint8Array;
	normal2: Uint8Array;
	highlights1: Uint8Array;
	highlights2: Uint8Array;
	foam: Uint8Array;
}

export const WATER_TEXTURE_SIZE: number = 256;

export function buildWaterTextures(size: number = WATER_TEXTURE_SIZE): WaterTextureSet {
	return {
		size,
		normal1: rippleNormals(size, 11, 6),
		normal2: rippleNormals(size, 23, 9),
		highlights1: glitterTexture(size, 31, 12),
		highlights2: glitterTexture(size, 47, 17),
		foam: foamTexture(size, 59, 10),
	};
}
