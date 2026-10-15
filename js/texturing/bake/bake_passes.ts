import type { BakeContext, BakePass, BakePassId, TexelSample, Vec3 } from './bake_types';
import type { BakeScene } from './bake_scene';

const GOLDEN_RATIO_CONJUGATE: number = 0.61803398875;

function clamp01(value: number): number {
	return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Cheap integer hash returning 0-1, used to decorrelate sampling patterns between texels. */
function hash01(seed: number): number {
	let h: number = (seed ^ 61) ^ (seed >>> 16);
	h = Math.imul(h + (h << 3), 0x27d4eb2d);
	h = h ^ (h >>> 15);
	return ((h >>> 0) % 65536) / 65536;
}

/**
 * Cosine weighted hemisphere direction around `n` from an R2 low-discrepancy sequence with per-texel rotation.
 * Writes the result into `out`.
 */
function hemisphereDirection(n: Vec3, k: number, rot_u: number, rot_v: number, flip: boolean, out: Vec3): void {
	const u: number = (rot_u + k * 0.7548776662466927) % 1;
	const v: number = (rot_v + k * 0.5698402909980532) % 1;
	const r: number = Math.sqrt(u);
	const phi: number = 2 * Math.PI * v;
	const lx: number = r * Math.cos(phi), ly: number = r * Math.sin(phi), lz: number = Math.sqrt(Math.max(0, 1 - u));
	// Tangent frame
	const ax: number = Math.abs(n[0]) > 0.9 ? 0 : 1, ay: number = Math.abs(n[0]) > 0.9 ? 1 : 0;
	let tx: number = ay * n[2], ty: number = -ax * n[2], tz: number = ax * n[1] - ay * n[0];
	const tl: number = Math.hypot(tx, ty, tz) || 1;
	tx /= tl; ty /= tl; tz /= tl;
	const bx: number = n[1] * tz - n[2] * ty, by: number = n[2] * tx - n[0] * tz, bz: number = n[0] * ty - n[1] * tx;
	const s: number = flip ? -1 : 1;
	out[0] = (tx * lx + bx * ly + n[0] * lz * s);
	out[1] = (ty * lx + by * ly + n[1] * lz * s);
	out[2] = (tz * lx + bz * ly + n[2] * lz * s);
}

const direction: Vec3 = [0, 0, 0];

const AO_PASS: BakePass = {
	id: 'ao',
	channel: 'ao',
	background: [1, 1, 1],
	needs_rays: true,
	shade(scene: BakeScene, ctx: BakeContext, s: TexelSample, out: Vec3): void {
		const samples: number = ctx.options.samples;
		const ru: number = hash01(s.seed), rv: number = hash01(s.seed * 7919 + 13);
		const ox: number = s.position[0] + s.normal[0] * ctx.bias;
		const oy: number = s.position[1] + s.normal[1] * ctx.bias;
		const oz: number = s.position[2] + s.normal[2] * ctx.bias;
		let blocked: number = 0;
		for (let k: number = 0; k < samples; k++) {
			hemisphereDirection(s.normal, k, ru, rv, false, direction);
			if (scene.bvh.isOccluded(ox, oy, oz, direction[0], direction[1], direction[2], ctx.max_distance)) blocked++;
		}
		const value: number = 1 - blocked / samples;
		out[0] = out[1] = out[2] = value;
	}
};

const THICKNESS_PASS: BakePass = {
	id: 'thickness',
	channel: null,
	background: [0, 0, 0],
	needs_rays: true,
	shade(scene: BakeScene, ctx: BakeContext, s: TexelSample, out: Vec3): void {
		const samples: number = ctx.options.samples;
		const ru: number = hash01(s.seed), rv: number = hash01(s.seed * 7919 + 13);
		const ox: number = s.position[0] - s.normal[0] * ctx.bias;
		const oy: number = s.position[1] - s.normal[1] * ctx.bias;
		const oz: number = s.position[2] - s.normal[2] * ctx.bias;
		let total: number = 0;
		for (let k: number = 0; k < samples; k++) {
			hemisphereDirection(s.normal, k, ru, rv, true, direction);
			const hit: number = scene.bvh.closestHit(ox, oy, oz, direction[0], direction[1], direction[2], ctx.max_distance);
			total += hit < 0 ? ctx.max_distance : hit;
		}
		const value: number = clamp01(total / samples / ctx.max_distance);
		out[0] = out[1] = out[2] = value;
	}
};

const CURVATURE_PASS: BakePass = {
	id: 'curvature',
	channel: null,
	background: [0.5, 0.5, 0.5],
	needs_rays: false,
	shade(scene: BakeScene, ctx: BakeContext, s: TexelSample, out: Vec3): void {
		const i: number = s.tri * 3;
		const k: number = scene.tri_curv[i] * s.b0 + scene.tri_curv[i + 1] * s.b1 + scene.tri_curv[i + 2] * s.b2;
		const value: number = 0.5 + 0.5 * Math.max(-1, Math.min(1, k * ctx.options.strength * 2));
		out[0] = out[1] = out[2] = value;
	}
};

const NORMAL_PASS: BakePass = {
	id: 'normal',
	channel: null,
	background: [0.5, 0.5, 1],
	needs_rays: false,
	shade(scene: BakeScene, ctx: BakeContext, s: TexelSample, out: Vec3): void {
		out[0] = s.normal[0] * 0.5 + 0.5;
		out[1] = s.normal[1] * 0.5 + 0.5;
		out[2] = s.normal[2] * 0.5 + 0.5;
	}
};

const POSITION_PASS: BakePass = {
	id: 'position',
	channel: null,
	background: [0, 0, 0],
	needs_rays: false,
	shade(scene: BakeScene, ctx: BakeContext, s: TexelSample, out: Vec3): void {
		for (let k: number = 0; k < 3; k++) {
			const extent: number = scene.max[k] - scene.min[k] || 1;
			out[k] = clamp01((s.position[k] - scene.min[k]) / extent);
		}
	}
};

const ID_PASS: BakePass = {
	id: 'id',
	channel: null,
	background: [0, 0, 0],
	needs_rays: false,
	shade(scene: BakeScene, ctx: BakeContext, s: TexelSample, out: Vec3): void {
		const hue: number = ((scene.tri_mesh[s.tri] + 1) * GOLDEN_RATIO_CONJUGATE) % 1;
		// HSV with full saturation and value
		const h6: number = hue * 6;
		const f: number = h6 - Math.floor(h6);
		switch (Math.floor(h6) % 6) {
			case 0: out[0] = 1; out[1] = f; out[2] = 0; break;
			case 1: out[0] = 1 - f; out[1] = 1; out[2] = 0; break;
			case 2: out[0] = 0; out[1] = 1; out[2] = f; break;
			case 3: out[0] = 0; out[1] = 1 - f; out[2] = 1; break;
			case 4: out[0] = f; out[1] = 0; out[2] = 1; break;
			default: out[0] = 1; out[1] = 0; out[2] = 1 - f; break;
		}
	}
};

export const BAKE_PASSES: Record<BakePassId, BakePass> = {
	ao: AO_PASS,
	thickness: THICKNESS_PASS,
	curvature: CURVATURE_PASS,
	normal: NORMAL_PASS,
	position: POSITION_PASS,
	id: ID_PASS,
};
