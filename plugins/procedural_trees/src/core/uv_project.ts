import type { Vec2, Vec3 } from './types';
import type { Rng } from './rng';
import type { UvRect } from './uv_layout';
import { cross, dot, normalize, sub } from './math';

/** Fraction of the target region's width a face's longest edge-span may cover. */
const MIN_COVERAGE = 0.4;
const MAX_COVERAGE = 0.75;

/**
 * Flat-projects one face into a randomly placed window of `rect`.
 * One uniform scale is used for both axes, so texels stay square (no stretch),
 * and the window is big enough that the face samples real texture detail
 * instead of a few pixels of noise.
 */
export function planarFaceUvs(corners: Vec3[], rect: UvRect, rng: Rng): Vec2[] {
	const origin: Vec3 = corners[0];
	const edge: Vec3 = sub(corners[1], origin);
	const normal: Vec3 = normalize(cross(edge, sub(corners[2], origin)));
	const axisU: Vec3 = normalize(edge);
	const axisV: Vec3 = cross(normal, axisU);

	const local: Vec2[] = corners.map((p: Vec3): Vec2 => {
		const d: Vec3 = sub(p, origin);
		return [dot(d, axisU), dot(d, axisV)];
	});
	const minX: number = Math.min(...local.map((p: Vec2): number => p[0]));
	const maxX: number = Math.max(...local.map((p: Vec2): number => p[0]));
	const minY: number = Math.min(...local.map((p: Vec2): number => p[1]));
	const maxY: number = Math.max(...local.map((p: Vec2): number => p[1]));
	const extent: number = Math.max(maxX - minX, maxY - minY, 1e-6);

	const regionWidth: number = rect.u1 - rect.u0;
	const regionHeight: number = rect.v1 - rect.v0;
	const scale: number = (regionWidth * rng.range(MIN_COVERAGE, MAX_COVERAGE)) / extent;
	const slackU: number = Math.max(0, regionWidth - (maxX - minX) * scale);
	const slackV: number = Math.max(0, regionHeight - (maxY - minY) * scale);
	const offsetU: number = rect.u0 + rng.range(0, slackU);
	const offsetV: number = rect.v0 + rng.range(0, slackV);

	return local.map((p: Vec2): Vec2 => [offsetU + (p[0] - minX) * scale, offsetV + (p[1] - minY) * scale]);
}
