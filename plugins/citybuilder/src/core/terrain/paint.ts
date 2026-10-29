import { terrainTile, tileOffset } from '../../texture/terrain_tiles';
import type { TerrainTile } from '../../texture/terrain_tiles';
import { ByteGrid } from '../grid';
import { Raster } from '../raster';
import type { Rgb } from '../raster';
import { clamp, fbm, saturate } from '../math';
import type { Vec3 } from '../types';
import type { Heightfield } from './heightfield';
import { SURFACES, SURFACE_COLORS } from './surfaces';

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
	/** How strongly ground below the water line is darkened, 0..1. The default is none: the water draws itself. */
	waterTint?: number;
	/** Direction towards the sun. */
	sun: Vec3;
	/** Output size in pixels per side. */
	region?: { x: number; z: number; width: number; depth: number };
	size: number;
	seed: number;
}

const ROAD_BED: Rgb = [92, 90, 86];

/** Resolution of the cached grain pattern and the world distance between its lattice points, metres. */
const GRAIN_SIZE: number = 256;
const GRAIN_STEP: number = 0.625;
const WATER_DEEP: Rgb = [30, 70, 95];

/** Fine surface grain, evaluated once per bake on a repeating lattice instead of per pixel. */
function grainTable(seed: number): Float32Array {
	const table: Float32Array = new Float32Array(GRAIN_SIZE * GRAIN_SIZE);
	for (let j: number = 0; j < GRAIN_SIZE; j++) {
		for (let i: number = 0; i < GRAIN_SIZE; i++) table[j * GRAIN_SIZE + i] = 0.9 + 0.2 * fbm(i * GRAIN_STEP * 0.8, j * GRAIN_STEP * 0.8, seed, 3);
	}
	return table;
}

/** Sun light per vertex, so shading costs one lookup per pixel rather than four height samples. */
function vertexLight(hf: Heightfield, sx: number, sy: number, sz: number): Float32Array {
	const light: Float32Array = new Float32Array(hf.cols * hf.rows);
	for (let r: number = 0; r < hf.rows; r++) {
		for (let c: number = 0; c < hf.cols; c++) {
			const n: Vec3 = hf.normal(hf.worldX(c), hf.worldZ(r));
			light[hf.index(c, r)] = clamp(0.45 + 0.7 * Math.max(0, n[0] * sx + n[1] * sy + n[2] * sz), 0.3, 1.2);
		}
	}
	return light;
}

interface SurfaceLook {
	tile: TerrainTile | null;
	r: number;
	g: number;
	b: number;
}

/** Per surface id (1-based): its tile, or the flat colour when it has none. */
function surfaceLooks(): SurfaceLook[] {
	const looks: SurfaceLook[] = [{ tile: null, ...flat(SURFACE_COLORS.grass) }];
	for (const name of SURFACES) looks.push({ tile: terrainTile(name), ...flat(SURFACE_COLORS[name]) });
	return looks;
}

function flat(c: Rgb): { r: number; g: number; b: number } {
	return { r: c[0], g: c[1], b: c[2] };
}

/**
 * Bakes the whole terrain into one albedo texture: blended surface colours, grain, water shading,
 * road beds and building pads, lit by a fixed sun. Baking keeps the terrain mesh free of per-face UVs,
 * so it can be decimated freely. The pixel loop allocates nothing and samples a surface tile once
 * wherever the four neighbouring cells agree, which is nearly everywhere.
 */
export function paintTerrain(input: PaintInput): Raster {
	const painter: TerrainPainter = createTerrainPainter(input);
	painter.paintRows(0, input.size);
	return painter.raster;
}

/** A bake that can run in bands, so the editor can spread it over several frames. */
export interface TerrainPainter {
	readonly raster: Raster;
	/** Paints pixel rows [from, to). */
	paintRows(from: number, to: number): void;
}

export function createTerrainPainter(input: PaintInput): TerrainPainter {
	const { hf, size } = input;
	const region = input.region ?? {x:hf.originX,z:hf.originZ,width:hf.width,depth:hf.depth};
	const out: Raster = new Raster(size, size);
	const data: Uint8ClampedArray = out.data;
	const sunLen: number = Math.hypot(input.sun[0], input.sun[1], input.sun[2]) || 1;
	const light: Float32Array = vertexLight(hf, input.sun[0] / sunLen, input.sun[1] / sunLen, input.sun[2] / sunLen);
	const grain: Float32Array = grainTable(input.seed);
	const looks: SurfaceLook[] = surfaceLooks();
	const maxLook: number = looks.length - 1;
	const cols: number = hf.cols;
	const heights: Float32Array = hf.heights;
	const roadW: Float32Array | undefined = input.roadWeight;
	const lotW: Float32Array | undefined = input.lotWeight;
	const pad: Rgb | undefined = input.padColor;
	const surfaces: ByteGrid = input.surfaces;
	const waterTint: number = input.waterTint ?? 0;
	const cellCols: number = surfaces.cols;
	const cellRows: number = surfaces.rows;
	const lattice: number = 1 / GRAIN_STEP;
	const sample: Float64Array = new Float64Array(12);
	const rgb: Float64Array = new Float64Array(3);

	/** Writes the colour of surface `id` at a world position into sample[o..o+2]. */
	const colorAt = (id: number, x: number, z: number, o: number): void => {
		const look: SurfaceLook = looks[id > 0 && id <= maxLook ? id : 1];
		if (look.tile) {
			const t: number = tileOffset(x, z);
			sample[o] = look.tile.pixels[t] * look.tile.tint[0];
			sample[o + 1] = look.tile.pixels[t + 1] * look.tile.tint[1];
			sample[o + 2] = look.tile.pixels[t + 2] * look.tile.tint[2];
		} else {
			sample[o] = look.r;
			sample[o + 1] = look.g;
			sample[o + 2] = look.b;
		}
	};

	const paintRows = (from: number, to: number): void => {
	for (let py: number = Math.max(0, from); py < Math.min(size, to); py++) {
		const z: number = region.z + ((py + 0.5) / size) * region.depth;
		const fr: number = hf.rowAt(z);
		const vr: number = clamp(Math.floor(fr), 0, hf.rows - 2);
		const tv: number = clamp(fr - vr, 0, 1);
		const cr: number = fr - 0.5;
		const r0: number = Math.floor(cr);
		const v: number = cr - r0;
		const rowA: number = clamp(r0, 0, cellRows - 1);
		const rowB: number = clamp(r0 + 1, 0, cellRows - 1);
		const gv: number = z * lattice;
		const gj: number = ((Math.floor(gv) % GRAIN_SIZE) + GRAIN_SIZE) % GRAIN_SIZE;
		const gj1: number = (gj + 1) % GRAIN_SIZE;
		const gfy: number = gv - Math.floor(gv);
		for (let px: number = 0; px < size; px++) {
			const x: number = region.x + ((px + 0.5) / size) * region.width;
			const fc: number = hf.colAt(x);
			const cc: number = fc - 0.5;
			const c0: number = Math.floor(cc);
			const u: number = cc - c0;
			const colA: number = clamp(c0, 0, cellCols - 1);
			const colB: number = clamp(c0 + 1, 0, cellCols - 1);
			const i00: number = surfaces.get(colA, rowA);
			const i10: number = surfaces.get(colB, rowA);
			const i01: number = surfaces.get(colA, rowB);
			const i11: number = surfaces.get(colB, rowB);
			if (i00 === i10 && i00 === i01 && i00 === i11) {
				colorAt(i00, x, z, 0);
				rgb[0] = sample[0];
				rgb[1] = sample[1];
				rgb[2] = sample[2];
			} else {
				colorAt(i00, x, z, 0);
				colorAt(i10, x, z, 3);
				colorAt(i01, x, z, 6);
				colorAt(i11, x, z, 9);
				for (let i: number = 0; i < 3; i++) {
					const top: number = sample[i] + (sample[3 + i] - sample[i]) * u;
					const bottom: number = sample[6 + i] + (sample[9 + i] - sample[6 + i]) * u;
					rgb[i] = top + (bottom - top) * v;
				}
			}

			// Grain: bilinear lookup in the cached lattice.
			const gu: number = x * lattice;
			const gi: number = ((Math.floor(gu) % GRAIN_SIZE) + GRAIN_SIZE) % GRAIN_SIZE;
			const gi1: number = (gi + 1) % GRAIN_SIZE;
			const gfx: number = gu - Math.floor(gu);
			const g0: number = grain[gj * GRAIN_SIZE + gi] + (grain[gj * GRAIN_SIZE + gi1] - grain[gj * GRAIN_SIZE + gi]) * gfx;
			const g1: number = grain[gj1 * GRAIN_SIZE + gi] + (grain[gj1 * GRAIN_SIZE + gi1] - grain[gj1 * GRAIN_SIZE + gi]) * gfx;
			const grainValue: number = g0 + (g1 - g0) * gfy;

			const vc: number = clamp(Math.floor(fc), 0, cols - 2);
			const tu: number = clamp(fc - vc, 0, 1);
			const a: number = vr * cols + vc;
			const b: number = a + 1;
			const d: number = a + cols;
			const e: number = d + 1;
			let road: number = 0;
			if (roadW) {
				const w: number = (roadW[a] + (roadW[b] - roadW[a]) * tu) * (1 - tv) + (roadW[d] + (roadW[e] - roadW[d]) * tu) * tv;
				road = saturate((w - 0.6) * 4);
			}
			let padAmount: number = 0;
			if (lotW && pad) {
				const w: number = (lotW[a] + (lotW[b] - lotW[a]) * tu) * (1 - tv) + (lotW[d] + (lotW[e] - lotW[d]) * tu) * tv;
				padAmount = saturate((w - 0.5) * 3) * 0.8;
			}
			const shade: number = ((light[a] + (light[b] - light[a]) * tu) * (1 - tv) + (light[d] + (light[e] - light[d]) * tu) * tv);
			const height: number = (heights[a] + (heights[b] - heights[a]) * tu) * (1 - tv) + (heights[d] + (heights[e] - heights[d]) * tu) * tv;
			const wet: number = waterTint > 0 ? wetnessOf(height, input.waterLevel) * 0.7 * waterTint : 0;
			const o: number = (py * size + px) * 4;
			for (let i: number = 0; i < 3; i++) {
				let value: number = rgb[i] * grainValue;
				value += (ROAD_BED[i] - value) * road;
				if (pad) value += (pad[i] - value) * padAmount;
				value *= shade;
				data[o + i] = value + (WATER_DEEP[i] - value) * wet;
			}
			data[o + 3] = 255;
		}
	}
	};
	return { raster: out, paintRows };
}

/** Same curve as `wetness`, inlined for the pixel loop. */
function wetnessOf(height: number, waterLevel: number): number {
	const t: number = clamp((height - (waterLevel + 0.3)) / (waterLevel - 1.2 - (waterLevel + 0.3)), 0, 1);
	return t * t * (3 - 2 * t);
}

function hashWords(h: number, words: ArrayLike<number>): number {
	let hash: number = h;
	for (let i: number = 0; i < words.length; i++) hash = Math.imul(hash ^ words[i], 16777619) >>> 0;
	return hash;
}

/**
 * Cheap fingerprint of everything a bake depends on. Edits that leave the ground, paint, roads and pads
 * alone (a new tree, a rezoned lot that stays empty) produce the same value, so the bake can be skipped.
 */
export function paintSignature(input: PaintInput): string {
	const { hf } = input;
	let h: number = 2166136261;
	h = hashWords(h, new Uint32Array(hf.heights.buffer, hf.heights.byteOffset, hf.heights.length));
	h = hashWords(h, input.surfaces.data);
	if (input.roadWeight) h = hashWords(h, new Uint32Array(input.roadWeight.buffer, input.roadWeight.byteOffset, input.roadWeight.length));
	if (input.lotWeight) h = hashWords(h, new Uint32Array(input.lotWeight.buffer, input.lotWeight.byteOffset, input.lotWeight.length));
	return `${h}:${hf.cols}x${hf.rows}x${hf.cellSize}:${input.size}:${input.waterLevel}:${input.seed}:${input.sun.join(',')}:${JSON.stringify(input.region)}`;
}
