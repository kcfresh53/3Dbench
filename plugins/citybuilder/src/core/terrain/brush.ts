import type { GridRect } from '../types';
import { fbm, saturate } from '../math';
import { Heightfield } from './heightfield';

export type BrushMode = 'raise' | 'lower' | 'smooth' | 'flatten' | 'level' | 'noise' | 'erode' | 'terrace';
export type BrushFalloff = 'smooth' | 'linear' | 'sharp' | 'flat';
export type BrushShape = 'round' | 'square';

export interface BrushSettings {
	mode: BrushMode;
	/** Brush radius in metres. */
	radius: number;
	/** 0..1. How strongly each dab acts. */
	strength: number;
	falloff: BrushFalloff;
	shape: BrushShape;
	/** Height the `level` brush pushes the ground towards, metres. */
	targetHeight: number;
	/** Wavelength of the `noise` brush, metres. */
	noiseScale: number;
	/** Step height of the `terrace` brush, metres. */
	terraceStep: number;
	seed: number;
}

export const DEFAULT_BRUSH: BrushSettings = {
	mode: 'raise',
	radius: 30,
	strength: 0.5,
	falloff: 'smooth',
	shape: 'round',
	targetHeight: 0,
	noiseScale: 24,
	terraceStep: 3,
	seed: 7,
};

/** What a stroke remembers between dabs. */
export interface StrokeState {
	/** Height under the first dab; the `flatten` brush pulls everything towards it. */
	anchorHeight: number | null;
	lastX: number | null;
	lastZ: number | null;
	/** Leftover distance so dab spacing stays even across pointer events. */
	carry: number;
	dabs: number;
}

export function newStroke(): StrokeState {
	return { anchorHeight: null, lastX: null, lastZ: null, carry: 0, dabs: 0 };
}

export function falloffWeight(kind: BrushFalloff, t: number): number {
	const x: number = saturate(1 - t);
	switch (kind) {
		case 'linear':
			return x;
		case 'sharp':
			return x * x * x;
		case 'flat':
			return t < 0.65 ? 1 : saturate((1 - t) / 0.35);
		default:
			return x * x * (3 - 2 * x);
	}
}

/** Normalised distance 0..1 from the brush centre; 1 or more is outside. */
function brushDistance(shape: BrushShape, dx: number, dz: number, radius: number): number {
	return shape === 'square' ? Math.max(Math.abs(dx), Math.abs(dz)) / radius : Math.hypot(dx, dz) / radius;
}

/** Metres a full-strength dab moves the ground; scales with brush size so big brushes shape big forms. */
function stepMetres(radius: number): number {
	return Math.min(1.5, Math.max(0.08, radius * 0.03));
}

function neighbourAverage(hf: Heightfield, c: number, r: number): number {
	return (hf.get(c - 1, r) + hf.get(c + 1, r) + hf.get(c, r - 1) + hf.get(c, r + 1) + hf.get(c - 1, r - 1) + hf.get(c + 1, r - 1) + hf.get(c - 1, r + 1) + hf.get(c + 1, r + 1)) / 8;
}

/**
 * Applies one dab and returns the vertex rectangle that changed. `invert` flips raise/lower and
 * makes the `level`/`flatten`/`terrace` brushes act more gently.
 */
export function applyDab(hf: Heightfield, x: number, z: number, settings: BrushSettings, stroke: StrokeState, invert: boolean = false): GridRect {
	const radius: number = Math.max(settings.radius, hf.cellSize * 0.5);
	const rect: GridRect = hf.rectAround(x, z, radius);
	if (stroke.anchorHeight === null) stroke.anchorHeight = hf.sample(x, z);
	const strength: number = saturate(settings.strength);
	const mode: BrushMode = settings.mode;
	// Smoothing and erosion read the unmodified neighbourhood, so work from a snapshot of the area.
	const needsSnapshot: boolean = mode === 'smooth' || mode === 'erode';
	const snapshot: Float32Array | null = needsSnapshot ? new Float32Array(hf.heights) : null;
	const step: number = stepMetres(radius);
	for (let r: number = rect.r0; r <= rect.r1; r++) {
		for (let c: number = rect.c0; c <= rect.c1; c++) {
			const dx: number = hf.worldX(c) - x;
			const dz: number = hf.worldZ(r) - z;
			const t: number = brushDistance(settings.shape, dx, dz, radius);
			if (t >= 1) continue;
			const w: number = falloffWeight(settings.falloff, t);
			if (w <= 0) continue;
			const i: number = hf.index(c, r);
			const h: number = hf.heights[i];
			switch (mode) {
				case 'raise':
					hf.heights[i] = h + (invert ? -1 : 1) * step * strength * w;
					break;
				case 'lower':
					hf.heights[i] = h + (invert ? 1 : -1) * step * strength * w;
					break;
				case 'smooth': {
					const avg: number = snapshotAverage(snapshot as Float32Array, hf, c, r);
					hf.heights[i] = h + (avg - h) * w * Math.min(1, strength * 0.9 + 0.05);
					break;
				}
				case 'flatten':
					hf.heights[i] = h + ((stroke.anchorHeight as number) - h) * w * Math.min(1, strength * (invert ? 0.4 : 1) + 0.1);
					break;
				case 'level':
					hf.heights[i] = h + (settings.targetHeight - h) * w * Math.min(1, strength * (invert ? 0.4 : 1) + 0.1);
					break;
				case 'noise': {
					const n: number = fbm(hf.worldX(c) / settings.noiseScale, hf.worldZ(r) / settings.noiseScale, settings.seed, 4) * 2 - 1;
					hf.heights[i] = h + n * step * strength * w * (invert ? -1 : 1);
					break;
				}
				case 'erode': {
					// Thermal erosion: material slides to a lower neighbour when the slope passes the talus angle.
					const talus: number = hf.cellSize * (invert ? 1.2 : 0.7);
					const src: Float32Array = snapshot as Float32Array;
					let moved: number = 0;
					for (const [oc, or] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
						const nc: number = clamp01(c + oc, hf.cols);
						const nr: number = clamp01(r + or, hf.rows);
						const diff: number = src[hf.index(c, r)] - src[hf.index(nc, nr)];
						if (diff > talus) moved += (diff - talus) * 0.25;
					}
					hf.heights[i] = h - moved * w * strength;
					// Deposit on lower neighbours that received material.
					break;
				}
				case 'terrace': {
					const stepSize: number = Math.max(0.25, settings.terraceStep);
					const snapped: number = Math.round(h / stepSize) * stepSize;
					hf.heights[i] = h + (snapped - h) * w * strength * (invert ? 0.4 : 1);
					break;
				}
			}
		}
	}
	hf.touch();
	stroke.dabs++;
	return rect;
}

function clamp01(n: number, size: number): number {
	return Math.max(0, Math.min(size - 1, n));
}

function snapshotAverage(src: Float32Array, hf: Heightfield, c: number, r: number): number {
	let sum: number = 0;
	for (let dr: number = -1; dr <= 1; dr++) {
		for (let dc: number = -1; dc <= 1; dc++) {
			if (dc === 0 && dr === 0) continue;
			sum += src[hf.index(clamp01(c + dc, hf.cols), clamp01(r + dr, hf.rows))];
		}
	}
	return sum / 8;
}

/**
 * Continues a stroke to a new pointer position, placing dabs at an even spacing along the path
 * (a quarter of the radius). Returns the union of everything that changed.
 */
export function strokeTo(hf: Heightfield, x: number, z: number, settings: BrushSettings, stroke: StrokeState, invert: boolean = false): GridRect | null {
	const spacing: number = Math.max(hf.cellSize * 0.5, settings.radius * 0.25);
	let dirty: GridRect | null = null;
	const merge = (rect: GridRect): void => {
		dirty = dirty
			? { c0: Math.min(dirty.c0, rect.c0), r0: Math.min(dirty.r0, rect.r0), c1: Math.max(dirty.c1, rect.c1), r1: Math.max(dirty.r1, rect.r1) }
			: rect;
	};
	if (stroke.lastX === null || stroke.lastZ === null) {
		merge(applyDab(hf, x, z, settings, stroke, invert));
		stroke.lastX = x;
		stroke.lastZ = z;
		return dirty;
	}
	const dx: number = x - stroke.lastX;
	const dz: number = z - stroke.lastZ;
	const length: number = Math.hypot(dx, dz);
	if (length < 1e-6) return null;
	let travelled: number = spacing - stroke.carry;
	while (travelled <= length) {
		const t: number = travelled / length;
		merge(applyDab(hf, stroke.lastX + dx * t, stroke.lastZ + dz * t, settings, stroke, invert));
		travelled += spacing;
	}
	stroke.carry = length - (travelled - spacing);
	stroke.lastX = x;
	stroke.lastZ = z;
	return dirty;
}

/** Raises or lowers the whole map by a fixed amount. */
export function offsetAll(hf: Heightfield, amount: number): void {
	for (let i: number = 0; i < hf.heights.length; i++) hf.heights[i] += amount;
	hf.touch();
}

/** Smooths the whole map `passes` times. */
export function smoothAll(hf: Heightfield, passes: number): void {
	for (let p: number = 0; p < passes; p++) {
		const src: Float32Array = new Float32Array(hf.heights);
		for (let r: number = 0; r < hf.rows; r++) {
			for (let c: number = 0; c < hf.cols; c++) {
				hf.heights[hf.index(c, r)] = (src[hf.index(c, r)] * 4 + neighbourAverage(hf, c, r) * 4) / 8;
			}
		}
	}
	hf.touch();
}
