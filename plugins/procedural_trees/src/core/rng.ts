import type { Vec3 } from './types';

/** Small seeded PRNG (mulberry32) so a seed always yields the same tree. */
export class Rng {
	private state: number;

	constructor(seed: number) {
		this.state = seed >>> 0;
	}

	next(): number {
		this.state = (this.state + 0x6d2b79f5) >>> 0;
		let t: number = this.state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	range(min: number, max: number): number {
		return min + (max - min) * this.next();
	}

	unitVector(): Vec3 {
		const z: number = this.range(-1, 1);
		const a: number = this.range(0, Math.PI * 2);
		const r: number = Math.sqrt(1 - z * z);
		return [r * Math.cos(a), z, r * Math.sin(a)];
	}
}
