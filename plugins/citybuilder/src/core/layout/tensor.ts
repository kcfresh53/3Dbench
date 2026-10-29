import type { Vec2 } from '../types';

/**
 * A direction field after Chen, Esch, Wonka, Müller and Zhang, "Interactive Procedural Street Modeling"
 * (SIGGRAPH 2008). Each point holds a 2×2 symmetric traceless tensor, written (a, b) = r·(cos 2θ, sin 2θ).
 * Its major eigenvector points along angle θ, its minor eigenvector across it. Tensors blend by simple
 * weighted addition, which is what lets a grid melt into a radial pattern without seams.
 */
export type TensorValue = [number, number];

export interface TensorSample {
	/** Unit direction streets follow in the major pass. */
	major: Vec2;
	/** Unit direction of the cross streets. */
	minor: Vec2;
	/** 0..1: how well the blended basis fields agree. Streets stop where this falls to zero. */
	strength: number;
}

/** One ingredient of the field. Returns a weight of zero where it has no say. */
export interface Basis {
	/** Weight and tensor at a ground position (metres). */
	at(x: number, z: number): { weight: number; tensor: TensorValue };
}

export function tensorOf(theta: number): TensorValue {
	return [Math.cos(2 * theta), Math.sin(2 * theta)];
}

/** Parallel streets at a fixed angle that fade with distance from a centre. */
export function gridBasis(x: number, z: number, size: number, decay: number, theta: number, weight: number): Basis {
	const t: TensorValue = tensorOf(theta);
	return {
		at: (px: number, pz: number) => ({ weight: weight * Math.exp((-decay * ((px - x) ** 2 + (pz - z) ** 2)) / (size * size)), tensor: t }),
	};
}

/** Spokes out of a centre, with rings across them. */
export function radialBasis(x: number, z: number, size: number, decay: number, weight: number): Basis {
	return {
		at: (px: number, pz: number) => {
			const dx: number = px - x;
			const dz: number = pz - z;
			const d2: number = dx * dx + dz * dz;
			return { weight: weight * Math.exp((-decay * d2) / (size * size)), tensor: tensorOf(Math.atan2(dz, dx)) };
		},
	};
}

/** Smooth value noise in [-1, 1], used to bend streets gently. */
export function valueNoise(x: number, z: number, seed: number): number {
	const hash = (ix: number, iz: number): number => {
		let h: number = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed | 0, 2147483647);
		h = Math.imul(h ^ (h >>> 13), 1274126177);
		return ((h ^ (h >>> 16)) >>> 0) / 4294967295 * 2 - 1;
	};
	const ix: number = Math.floor(x);
	const iz: number = Math.floor(z);
	const fx: number = x - ix;
	const fz: number = z - iz;
	const sx: number = fx * fx * (3 - 2 * fx);
	const sz: number = fz * fz * (3 - 2 * fz);
	const top: number = hash(ix, iz) * (1 - sx) + hash(ix + 1, iz) * sx;
	const bottom: number = hash(ix, iz + 1) * (1 - sx) + hash(ix + 1, iz + 1) * sx;
	return top * (1 - sz) + bottom * sz;
}

export class TensorField {
	private readonly bases: Basis[] = [];
	/** Maximum extra rotation from noise, radians. */
	noiseAngle: number = 0;
	/** Size of the noise features, metres. */
	noiseScale: number = 160;

	constructor(private readonly seed: number) {}

	add(basis: Basis): this {
		this.bases.push(basis);
		return this;
	}

	/** Blended tensor, or null where no basis reaches. */
	tensorAt(x: number, z: number): { a: number; b: number; total: number } | null {
		let a: number = 0;
		let b: number = 0;
		let total: number = 0;
		for (const basis of this.bases) {
			const r = basis.at(x, z);
			if (r.weight < 1e-5) continue;
			a += r.weight * r.tensor[0];
			b += r.weight * r.tensor[1];
			total += r.weight;
		}
		return total < 1e-4 ? null : { a, b, total };
	}

	sample(x: number, z: number): TensorSample | null {
		const t = this.tensorAt(x, z);
		if (!t) return null;
		const strength: number = Math.hypot(t.a, t.b) / t.total;
		if (strength < 0.04) return null;
		let theta: number = 0.5 * Math.atan2(t.b, t.a);
		if (this.noiseAngle > 0) theta += valueNoise(x / this.noiseScale, z / this.noiseScale, this.seed) * this.noiseAngle;
		const major: Vec2 = [Math.cos(theta), Math.sin(theta)];
		return { major, minor: [-major[1], major[0]], strength };
	}
}
