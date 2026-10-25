import type { Branch, TreeParams, Vec3 } from './types';
import { Rng } from './rng';
import {
	add,
	clamp,
	cross,
	degToRad,
	lerp,
	lerp3,
	normalize,
	perpendicular,
	scale,
	sub,
} from './math';
import { crownFactor } from './crown';

const GOLDEN_ANGLE: number = Math.PI * (3 - Math.sqrt(5));
/** Segments per branch generation (index = level). */
const LEVEL_SEGMENTS: number[] = [0, 3, 2, 1];

export interface PathSample {
	position: Vec3;
	direction: Vec3;
	radius: number;
}

/** Position, direction and radius at fraction t (0..1) along a branch. */
export function samplePath(branch: Branch, t: number): PathSample {
	const lastIndex: number = branch.points.length - 1;
	const f: number = clamp(t, 0, 1) * lastIndex;
	const i: number = Math.min(Math.floor(f), lastIndex - 1);
	const k: number = f - i;
	return {
		position: lerp3(branch.points[i], branch.points[i + 1], k),
		direction: normalize(sub(branch.points[i + 1], branch.points[i])),
		radius: lerp(branch.radii[i], branch.radii[i + 1], k),
	};
}

interface PathSpec {
	start: Vec3;
	direction: Vec3;
	length: number;
	segments: number;
	startRadius: number;
	endFactor: number;
	bend: number;
	upBias: number;
	level: number;
	stylized: boolean;
}

function growPath(spec: PathSpec, rng: Rng): Branch {
	const points: Vec3[] = [spec.start];
	const radii: number[] = [];
	const segmentLength: number = spec.length / spec.segments;
	let direction: Vec3 = normalize(spec.direction);
	let position: Vec3 = spec.start;
	for (let s = 0; s < spec.segments; s++) {
		if (s > 0) {
			const wobble: Vec3 = scale(rng.unitVector(), spec.bend);
			direction = normalize(add(add(direction, wobble), [0, spec.upBias * 0.25, 0]));
		}
		position = add(position, scale(direction, segmentLength));
		points.push(position);
	}
	for (let i = 0; i <= spec.segments; i++) {
		radii.push(i === spec.segments ? 0 : spec.startRadius * Math.pow(lerp(1, spec.endFactor, i / spec.segments), spec.stylized ? 1 : 1.25));
	}
	return { points, radii, level: spec.level, length: spec.length };
}

interface GrowContext {
	params: TreeParams;
	quality: number;
	rng: Rng;
	branches: Branch[];
	minRadius: number;
}

function growChildren(ctx: GrowContext, parentIndex: number): void {
	const parent: Branch = ctx.branches[parentIndex];
	const level: number = parent.level + 1;
	const p: TreeParams = ctx.params;
	if (level > p.branchLevels) return;

	const baseCount: number = level === 1 ? p.branchCount : Math.max(2, Math.round(p.branchCount * 0.6));
	const count: number = p.variant === 'stylized' ? Math.max(2, Math.round(baseCount * ctx.quality)) : baseCount;
	const start: number = level === 1 ? p.branchStart : 0.25;
	const spread: number = (0.97 - start) / count;

	for (let i = 0; i < count; i++) {
		const t: number = clamp(lerp(start, 0.97, (i + 0.5) / count) + ctx.rng.range(-0.3, 0.3) * spread, 0, 0.97);
		const sample: PathSample = samplePath(parent, t);
		const crownT = clamp((t - p.branchStart) / (1 - p.branchStart), 0, 1);
		const crown: number = level === 1 ? (p.variant === 'stylized' ? crownFactor(p.crownShape, t) : p.crownShape === 'round' ? 0.15 + 0.85 * Math.pow(Math.sin(Math.PI * crownT), 0.65) : crownFactor(p.crownShape, crownT)) : 1 - 0.5 * t;
		const length: number = parent.length * p.branchLength * crown;
		if (length < p.height * 0.02) continue;

		const azimuth: number = p.variant === 'stylized' ? i * GOLDEN_ANGLE + ctx.rng.range(-0.3, 0.3) : i * GOLDEN_ANGLE + parent.points[0][1] * 0.73 + ctx.rng.range(-0.5, 0.5);
		const tilt: number = p.variant === 'stylized' ? degToRad(p.branchAngle) + ctx.rng.range(-0.15, 0.15) : degToRad(p.branchAngle * (level === 1 ? lerp(1.2, 0.65, crownT) : 1)) + ctx.rng.range(-0.18, 0.18);
		const u: Vec3 = perpendicular(sample.direction);
		const v: Vec3 = cross(sample.direction, u);
		const side: Vec3 = add(scale(u, Math.cos(azimuth)), scale(v, Math.sin(azimuth)));
		const direction: Vec3 = normalize(
			add(scale(sample.direction, Math.cos(tilt)), scale(side, Math.sin(tilt))),
		);

		const branch: Branch = growPath(
			{
				start: sample.position,
				direction,
				length,
				segments: Math.max(1, LEVEL_SEGMENTS[level] ?? 1),
				startRadius: Math.max(sample.radius * p.branchThickness, ctx.minRadius),
				endFactor: p.variant === 'stylized' ? 0.25 : 0.05,
				bend: p.branchBend,
				upBias: p.gravity,
				level,
				stylized: p.variant === 'stylized',
			},
			ctx.rng,
		);
		branch.parentIndex = parentIndex;
		branch.priority = (i * 0.61803398875) % 1;
		ctx.branches.push(branch);
		growChildren(ctx, ctx.branches.length - 1);
	}
}

/**
 * Builds a stable branch skeleton. Quality prunes detail from the complete
 * hierarchy without changing retained paths.
 */
export function growSkeleton(params: TreeParams, quality: number, rng: Rng): Branch[] {
	const segments: number = params.variant === 'stylized' ? Math.max(3, Math.round(params.trunkSegments * (0.6 + 0.4 * quality))) : params.trunkSegments;
	const baseRadius: number = (params.height * params.trunkThickness) / 100;
	const trunk: Branch = growPath(
		{
			start: [0, 0, 0],
			direction: [0, 1, 0],
			length: params.height,
			segments,
			startRadius: baseRadius,
			endFactor: params.trunkTaper,
			bend: params.trunkBend,
			upBias: 0.35,
			level: 0,
			stylized: params.variant === 'stylized',
		},
		rng,
	);
	trunk.radii[0] *= 1 + params.rootFlare;
	if (trunk.radii.length > 2) trunk.radii[1] *= 1 + params.rootFlare * 0.35;

	const ctx: GrowContext = {
		params,
		quality,
		rng,
		branches: [trunk],
		minRadius: params.height * 0.0015,
	};
	growChildren(ctx, 0);
	if (params.variant === 'stylized') return ctx.branches;
	// Always grow the same complete skeleton for a seed. Budget/LOD changes only
	// remove branches; they must not move every retained branch to a different place.
	const retained: boolean[] = [true];
	return ctx.branches.filter((branch, index) => {
		if (!index) return true;
		const threshold = branch.level === 1 ? Math.min(1, quality / 0.35) : quality;
		retained[index] = !!retained[branch.parentIndex!] && branch.priority! <= threshold;
		return retained[index];
	});
}
