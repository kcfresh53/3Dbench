import type { Vec2, Vec3 } from './types';

export function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, n));
}

export function saturate(n: number): number {
	return clamp(n, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
	const t: number = saturate((x - edge0) / (edge1 - edge0 || 1e-9));
	return t * t * (3 - 2 * t);
}

export function round(n: number, places: number = 4): number {
	const f: number = Math.pow(10, places);
	return Math.round(n * f) / f;
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
	return Math.hypot(ax - bx, az - bz);
}

export function normalize2(x: number, z: number): Vec2 {
	const l: number = Math.hypot(x, z);
	return l < 1e-12 ? [0, 1] : [x / l, z / l];
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function normalize3(a: Vec3): Vec3 {
	const l: number = Math.hypot(a[0], a[1], a[2]);
	return l < 1e-12 ? [0, 1, 0] : [a[0] / l, a[1] / l, a[2] / l];
}

export function dot3(a: Vec3, b: Vec3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Deterministic 32-bit generator (mulberry32). Same seed, same sequence, on every machine. */
export class Rng {
	private state: number;

	constructor(seed: number) {
		this.state = seed >>> 0 || 0x9e3779b9;
	}

	next(): number {
		this.state = (this.state + 0x6d2b79f5) >>> 0;
		let t: number = this.state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	range(lo: number, hi: number): number {
		return lo + (hi - lo) * this.next();
	}

	/** Integer in [lo, hi], both inclusive. */
	int(lo: number, hi: number): number {
		return lo + Math.floor(this.next() * (hi - lo + 1));
	}

	chance(probability: number): boolean {
		return this.next() < probability;
	}

	pick<T>(items: readonly T[]): T {
		return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))];
	}

	/** Picks an index by relative weights. */
	weighted(weights: readonly number[]): number {
		let total: number = 0;
		for (const w of weights) total += Math.max(0, w);
		if (total <= 0) return 0;
		let roll: number = this.next() * total;
		for (let i: number = 0; i < weights.length; i++) {
			roll -= Math.max(0, weights[i]);
			if (roll <= 0) return i;
		}
		return weights.length - 1;
	}
}

/** Stable hash of two integers and a seed, in [0, 1). */
export function hash2(x: number, y: number, seed: number): number {
	let h: number = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Hash of a string, for stable ids and seeds. */
export function hashString(text: string): number {
	let h: number = 2166136261;
	for (let i: number = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
	return h >>> 0;
}

/** Smooth value noise in [0, 1]. */
export function valueNoise(x: number, y: number, seed: number): number {
	const x0: number = Math.floor(x);
	const y0: number = Math.floor(y);
	const fx: number = x - x0;
	const fy: number = y - y0;
	const sx: number = fx * fx * (3 - 2 * fx);
	const sy: number = fy * fy * (3 - 2 * fy);
	const a: number = hash2(x0, y0, seed);
	const b: number = hash2(x0 + 1, y0, seed);
	const c: number = hash2(x0, y0 + 1, seed);
	const d: number = hash2(x0 + 1, y0 + 1, seed);
	return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

/** Fractal noise in [0, 1]. */
export function fbm(x: number, y: number, seed: number, octaves: number = 5, lacunarity: number = 2, gain: number = 0.5): number {
	let amplitude: number = 1;
	let frequency: number = 1;
	let sum: number = 0;
	let norm: number = 0;
	for (let i: number = 0; i < octaves; i++) {
		sum += valueNoise(x * frequency, y * frequency, seed + i * 101) * amplitude;
		norm += amplitude;
		amplitude *= gain;
		frequency *= lacunarity;
	}
	return sum / norm;
}

/** Ridged noise in [0, 1]: sharp crests, useful for mountains. */
export function ridged(x: number, y: number, seed: number, octaves: number = 5): number {
	let amplitude: number = 1;
	let frequency: number = 1;
	let sum: number = 0;
	let norm: number = 0;
	for (let i: number = 0; i < octaves; i++) {
		const n: number = 1 - Math.abs(valueNoise(x * frequency, y * frequency, seed + i * 53) * 2 - 1);
		sum += n * n * amplitude;
		norm += amplitude;
		amplitude *= 0.5;
		frequency *= 2;
	}
	return sum / norm;
}
