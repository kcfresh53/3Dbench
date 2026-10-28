/** Small deterministic generator (mulberry32). Same seed, same road, on every machine. */
export class Rng {
	private state: number;

	constructor(seed: number) {
		this.state = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
	}

	next(): number {
		this.state = (this.state + 0x6d2b79f5) >>> 0;
		let t: number = this.state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	/** Uniform value in [-1, 1). */
	signed(): number {
		return this.next() * 2 - 1;
	}

	range(lo: number, hi: number): number {
		return lo + (hi - lo) * this.next();
	}

	int(count: number): number {
		return Math.min(count - 1, Math.floor(this.next() * count));
	}
}

/** Hashes a string to a 32 bit seed so ids can drive stable random streams. */
export function hashSeed(text: string): number {
	let h: number = 2166136261;
	for (let i: number = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}
