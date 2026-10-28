import type { Vec3 } from './types';
import { clamp, distance, flatDirection, length, mix, normalize, rightOf, sub } from './vec';

/** A point on a road centreline together with its driving frame. */
export interface CurveFrame {
	position: Vec3;
	/** Unit horizontal direction of travel. */
	forward: Vec3;
	/** Unit horizontal right-hand direction. */
	right: Vec3;
	/** Slope: height change per unit of horizontal travel. */
	slope: number;
}

const TABLE_STEPS: number = 96;

/** Cubic Bézier road centreline with arc-length parametrisation. */
export class RoadCurve {
	readonly p0: Vec3;
	readonly c0: Vec3;
	readonly c1: Vec3;
	readonly p1: Vec3;
	readonly length: number;
	private readonly table: number[];

	constructor(p0: Vec3, c0: Vec3, c1: Vec3, p1: Vec3) {
		this.p0 = p0;
		this.c0 = c0;
		this.c1 = c1;
		this.p1 = p1;
		this.table = [0];
		let previous: Vec3 = p0;
		for (let i: number = 1; i <= TABLE_STEPS; i++) {
			const point: Vec3 = this.pointAt(i / TABLE_STEPS);
			this.table.push(this.table[i - 1] + distance(previous, point));
			previous = point;
		}
		this.length = this.table[TABLE_STEPS];
	}

	static straight(a: Vec3, b: Vec3): RoadCurve {
		return new RoadCurve(a, mix(a, b, 1 / 3), mix(a, b, 2 / 3), b);
	}

	pointAt(t: number): Vec3 {
		const u: number = 1 - t;
		const a: number = u * u * u;
		const b: number = 3 * u * u * t;
		const c: number = 3 * u * t * t;
		const d: number = t * t * t;
		return [
			a * this.p0[0] + b * this.c0[0] + c * this.c1[0] + d * this.p1[0],
			a * this.p0[1] + b * this.c0[1] + c * this.c1[1] + d * this.p1[1],
			a * this.p0[2] + b * this.c0[2] + c * this.c1[2] + d * this.p1[2],
		];
	}

	derivativeAt(t: number): Vec3 {
		const u: number = 1 - t;
		const a: number = 3 * u * u;
		const b: number = 6 * u * t;
		const c: number = 3 * t * t;
		return [
			a * (this.c0[0] - this.p0[0]) + b * (this.c1[0] - this.c0[0]) + c * (this.p1[0] - this.c1[0]),
			a * (this.c0[1] - this.p0[1]) + b * (this.c1[1] - this.c0[1]) + c * (this.p1[1] - this.c1[1]),
			a * (this.c0[2] - this.p0[2]) + b * (this.c1[2] - this.c0[2]) + c * (this.p1[2] - this.c1[2]),
		];
	}

	/** Curve parameter for an arc-length distance from the start. */
	tAtDistance(distanceFromStart: number): number {
		const d: number = clamp(distanceFromStart, 0, this.length);
		let lo: number = 0;
		let hi: number = TABLE_STEPS;
		while (hi - lo > 1) {
			const mid: number = (lo + hi) >> 1;
			if (this.table[mid] < d) lo = mid;
			else hi = mid;
		}
		const span: number = this.table[hi] - this.table[lo];
		const f: number = span < 1e-12 ? 0 : (d - this.table[lo]) / span;
		return (lo + f) / TABLE_STEPS;
	}

	distanceAtT(t: number): number {
		const x: number = clamp(t, 0, 1) * TABLE_STEPS;
		const i: number = Math.min(TABLE_STEPS - 1, Math.floor(x));
		return this.table[i] + (this.table[i + 1] - this.table[i]) * (x - i);
	}

	frameAt(distanceFromStart: number): CurveFrame {
		const t: number = this.tAtDistance(distanceFromStart);
		const position: Vec3 = this.pointAt(t);
		let tangent: Vec3 = this.derivativeAt(t);
		let forward: Vec3 | null = flatDirection(tangent);
		if (!forward) {
			// Vertical tangent: borrow a nearby direction.
			tangent = sub(this.pointAt(Math.min(1, t + 0.02)), this.pointAt(Math.max(0, t - 0.02)));
			forward = flatDirection(tangent) ?? [0, 0, 1];
		}
		const horizontal: number = Math.hypot(tangent[0], tangent[2]) || 1;
		return { position, forward, right: rightOf(forward), slope: tangent[1] / horizontal };
	}

	/** Unit tangent leaving the start (`end` false) or arriving at the end (`end` true). */
	endTangent(end: boolean): Vec3 {
		const t: Vec3 = normalize(this.derivativeAt(end ? 1 : 0));
		return length(t) > 0 ? t : normalize(sub(this.p1, this.p0));
	}

	/** Sub-curve between two arc-length distances (exact, by de Casteljau splitting). */
	slice(fromDistance: number, toDistance: number): RoadCurve {
		const t0: number = this.tAtDistance(fromDistance);
		const t1: number = this.tAtDistance(toDistance);
		return this.splitAt(t1)[0].splitAt(t0 / Math.max(t1, 1e-9))[1];
	}

	/** Splits at parameter `t` into two curves that reproduce this one exactly. */
	splitAt(t: number): [RoadCurve, RoadCurve] {
		const a: Vec3 = mix(this.p0, this.c0, t);
		const b: Vec3 = mix(this.c0, this.c1, t);
		const c: Vec3 = mix(this.c1, this.p1, t);
		const d: Vec3 = mix(a, b, t);
		const e: Vec3 = mix(b, c, t);
		const f: Vec3 = mix(d, e, t);
		return [new RoadCurve(this.p0, a, d, f), new RoadCurve(f, e, c, this.p1)];
	}

	/**
	 * Distances along the curve at which cross-sections are placed. Straight stretches use a few
	 * long spans; bends add stops until the chord error drops below `tolerance`. `maxSpan` also
	 * bounds every span so textures keep a consistent density.
	 */
	stops(from: number, to: number, maxSpan: number, tolerance: number): number[] {
		const result: number[] = [from];
		if (to - from < 1e-6) return result;
		const refine = (a: number, b: number, depth: number): void => {
			const span: number = b - a;
			const mid: number = (a + b) / 2;
			let needsSplit: boolean = span > maxSpan && depth < 12;
			if (!needsSplit && depth < 12) {
				const pa: Vec3 = this.frameAt(a).position;
				const pb: Vec3 = this.frameAt(b).position;
				const pm: Vec3 = this.frameAt(mid).position;
				const q1: Vec3 = this.frameAt(a + span * 0.25).position;
				const q3: Vec3 = this.frameAt(a + span * 0.75).position;
				const error: number = Math.max(
					distance(pm, mix(pa, pb, 0.5)),
					distance(q1, mix(pa, pb, 0.25)),
					distance(q3, mix(pa, pb, 0.75)),
				);
				needsSplit = error > tolerance;
			}
			if (needsSplit) {
				refine(a, mid, depth + 1);
				refine(mid, b, depth + 1);
			} else {
				result.push(b);
			}
		};
		refine(from, to, 0);
		return result;
	}

	/** Polyline approximation used for intersection tests and snapping. */
	polyline(step: number): Vec3[] {
		const count: number = Math.max(2, Math.ceil(this.length / Math.max(step, 1e-3)) + 1);
		const points: Vec3[] = [];
		for (let i: number = 0; i < count; i++) points.push(this.frameAt((this.length * i) / (count - 1)).position);
		return points;
	}
}

/** Finds the closest point on a curve to `point` on the XZ plane: arc-length distance and the point. */
export function closestOnCurve(curve: RoadCurve, point: Vec3, samples: number = 48): { distance: number; along: number; position: Vec3 } {
	let bestAlong: number = 0;
	let best: number = Infinity;
	for (let i: number = 0; i <= samples; i++) {
		const along: number = (curve.length * i) / samples;
		const p: Vec3 = curve.frameAt(along).position;
		const d: number = Math.hypot(p[0] - point[0], p[2] - point[2]);
		if (d < best) {
			best = d;
			bestAlong = along;
		}
	}
	// Refine with a few bisection-like steps around the best sample.
	let step: number = curve.length / samples;
	for (let i: number = 0; i < 12; i++) {
		for (const candidate of [bestAlong - step, bestAlong + step]) {
			const along: number = clamp(candidate, 0, curve.length);
			const p: Vec3 = curve.frameAt(along).position;
			const d: number = Math.hypot(p[0] - point[0], p[2] - point[2]);
			if (d < best) {
				best = d;
				bestAlong = along;
			}
		}
		step /= 2;
	}
	return { distance: best, along: bestAlong, position: curve.frameAt(bestAlong).position };
}

/** Point at a lateral offset (along the right vector) and height above the centreline. */
export function offsetPoint(frame: CurveFrame, lateral: number, height: number): Vec3 {
	return [
		frame.position[0] + frame.right[0] * lateral,
		frame.position[1] + height,
		frame.position[2] + frame.right[2] * lateral,
	];
}
