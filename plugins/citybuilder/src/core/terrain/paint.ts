import { terrainSample } from '../../texture/terrain_tiles';
import { ByteGrid } from '../grid';
import { Raster } from '../raster';
import type { Rgb } from '../raster';
import { clamp, fbm, lerp, saturate } from '../math';
import type { Vec3 } from '../types';
import type { Heightfield } from './heightfield';
import { SURFACE_COLORS, surfaceName, wetness } from './surfaces';
import type { SurfaceName } from './surfaces';

export interface PaintInput {
	hf: Heightfield;
	/** Surface id per cell (1-based). */
	surfaces: ByteGrid;
	/** 0..1 per vertex: ground claimed by roads. */
	roadWeight?: Float32Array;
	/** 0..1 per vertex: ground claimed by building pads. */
	lotWeight?: Float32Array;
	/** Colour for building pads, used where lotWeight is high. */
	padColor?: Rgb;
	waterLevel: number;
	/** Direction towards the sun. */
	sun: Vec3;
	/** Output size in pixels per side. */
	size: number;
	seed: number;
}

const ROAD_BED: Rgb = [92, 90, 86];

function cellColor(surfaces: ByteGrid, c: number, r: number, x: number, z: number): Rgb {
	const name: SurfaceName | null = surfaceName(surfaces.get(clamp(c, 0, surfaces.cols - 1), clamp(r, 0, surfaces.rows - 1)));
	return terrainSample(name ?? 'grass', x, z, SURFACE_COLORS[name ?? 'grass']);
}

function bilinearVertex(hf: Heightfield, data: Float32Array, fc: number, fr: number): number {
	const c: number = clamp(Math.floor(fc), 0, hf.cols - 2);
	const r: number = clamp(Math.floor(fr), 0, hf.rows - 2);
	const u: number = clamp(fc - c, 0, 1);
	const v: number = clamp(fr - r, 0, 1);
	const a: number = data[hf.index(c, r)];
	const b: number = data[hf.index(c + 1, r)];
	const d: number = data[hf.index(c, r + 1)];
	const e: number = data[hf.index(c + 1, r + 1)];
	return lerp(lerp(a, b, u), lerp(d, e, u), v);
}

/**
 * Bakes the whole terrain into one albedo texture: blended surface colours, grain, water shading,
 * road beds and building pads, lit by a fixed sun. Baking keeps the terrain mesh free of per-face UVs,
 * so it can be decimated freely.
 */
export function paintTerrain(input: PaintInput): Raster {
	const { hf, size } = input;
	const out: Raster = new Raster(size, size);
	const sunLen: number = Math.hypot(input.sun[0], input.sun[1], input.sun[2]) || 1;
	const sx: number = input.sun[0] / sunLen;
	const sy: number = input.sun[1] / sunLen;
	const sz: number = input.sun[2] / sunLen;
	for (let py: number = 0; py < size; py++) {
		const z: number = hf.originZ + ((py + 0.5) / size) * hf.depth;
		for (let px: number = 0; px < size; px++) {
			const x: number = hf.originX + ((px + 0.5) / size) * hf.width;
			const fc: number = hf.colAt(x);
			const fr: number = hf.rowAt(z);
			// Blend the four nearest cell colours, so surface borders are soft.
			const cc: number = fc - 0.5;
			const cr: number = fr - 0.5;
			const c0: number = Math.floor(cc);
			const r0: number = Math.floor(cr);
			const u: number = cc - c0;
			const v: number = cr - r0;
			const k00: Rgb = cellColor(input.surfaces, c0, r0, x, z);
			const k10: Rgb = cellColor(input.surfaces, c0 + 1, r0, x, z);
			const k01: Rgb = cellColor(input.surfaces, c0, r0 + 1, x, z);
			const k11: Rgb = cellColor(input.surfaces, c0 + 1, r0 + 1, x, z);
			const grain: number = 0.9 + 0.2 * fbm(x * 0.8, z * 0.8, input.seed, 3);
			const rgb: Rgb = [0, 0, 0];
			for (let i: number = 0; i < 3; i++) rgb[i] = lerp(lerp(k00[i], k10[i], u), lerp(k01[i], k11[i], u), v) * grain;

			const road: number = input.roadWeight ? saturate((bilinearVertex(hf, input.roadWeight, fc, fr) - 0.6) * 4) : 0;
			const pad: number = input.lotWeight ? saturate((bilinearVertex(hf, input.lotWeight, fc, fr) - 0.5) * 3) : 0;
			for (let i: number = 0; i < 3; i++) {
				rgb[i] = lerp(rgb[i], ROAD_BED[i], road);
				if (input.padColor) rgb[i] = lerp(rgb[i], input.padColor[i], pad * 0.8);
			}

			const n: Vec3 = hf.normal(x, z);
			const light: number = clamp(0.45 + 0.7 * Math.max(0, n[0] * sx + n[1] * sy + n[2] * sz), 0.3, 1.2);
			const height: number = hf.sample(x, z);
			const wet: number = wetness(height, input.waterLevel);
			for (let i: number = 0; i < 3; i++) {
				const shaded: number = rgb[i] * light;
				const deep: number = [30, 70, 95][i];
				out.data[(py * size + px) * 4 + i] = clamp(lerp(shaded, deep, wet * 0.7), 0, 255);
			}
			out.data[(py * size + px) * 4 + 3] = 255;
		}
	}
	return out;
}
