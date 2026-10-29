import { Rng } from '../math';
import type { Vec2 } from '../types';
import { SpatialHash } from './spatial';
import type { StreamPoint } from './spatial';
import type { TensorField, TensorSample } from './tensor';

export type StreetRank = 'main' | 'street';

export interface Streamline {
	id: number;
	/** 0 follows the major direction of the field, 1 the minor one. */
	dir: 0 | 1;
	rank: StreetRank;
	points: Vec2[];
}

export interface TraceBounds {
	minX: number;
	minZ: number;
	maxX: number;
	maxZ: number;
}

/** Where streets may go. */
export type DomainTest = (x: number, z: number) => boolean;

export interface TracePass {
	dir: 0 | 1;
	rank: StreetRank;
	/** Spacing wanted between neighbouring streets of this pass at a position, metres. */
	spacing: (x: number, z: number) => number;
	/** Streets shorter than this are dropped, metres. */
	minLength: number;
	maxLength: number;
	/** Smallest angle (radians) at which a street may end by joining another one. */
	minJoinAngle: number;
}

const MAX_LINES: number = 900;

function dot(a: Vec2, b: Vec2): number {
	return a[0] * b[0] + a[1] * b[1];
}

/**
 * Traces evenly spaced streets along a tensor field: the Jobard–Lefer streamline placement used by
 * Chen et al. (2008). A street is grown from a seed in both directions until it leaves the allowed
 * ground, meets the field's singularities or comes within half the spacing of a street of the same
 * direction. New seeds are then dropped one spacing to either side of every street, so lines fill the
 * area evenly. Streets that run into another street end on it, which makes proper junctions.
 */
export class StreamlineTracer {
	readonly lines: Streamline[] = [];
	private readonly hashes: [SpatialHash, SpatialHash];

	constructor(
		private readonly field: TensorField,
		private readonly allowed: DomainTest,
		private readonly bounds: TraceBounds,
		private readonly rng: Rng,
		private readonly step: number,
	) {
		this.hashes = [new SpatialHash(step * 4), new SpatialHash(step * 4)];
	}

	private direction(s: TensorSample, dir: 0 | 1): Vec2 {
		return dir === 0 ? s.major : s.minor;
	}

	private heading(x: number, z: number, dir: 0 | 1, previous: Vec2 | null): Vec2 | null {
		const s: TensorSample | null = this.field.sample(x, z);
		if (!s) return null;
		const v: Vec2 = this.direction(s, dir);
		return previous && dot(v, previous) < 0 ? [-v[0], -v[1]] : v;
	}

	/** One Runge–Kutta step along the field. */
	private advance(p: Vec2, dir: 0 | 1, previous: Vec2): Vec2 | null {
		const h: number = this.step;
		const k1: Vec2 | null = this.heading(p[0], p[1], dir, previous);
		if (!k1) return null;
		const k2: Vec2 | null = this.heading(p[0] + (k1[0] * h) / 2, p[1] + (k1[1] * h) / 2, dir, k1);
		const k3: Vec2 | null = k2 && this.heading(p[0] + (k2[0] * h) / 2, p[1] + (k2[1] * h) / 2, dir, k2);
		const k4: Vec2 | null = k3 && this.heading(p[0] + k3[0] * h, p[1] + k3[1] * h, dir, k3);
		if (!k2 || !k3 || !k4) return k1;
		const dx: number = k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0];
		const dz: number = k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1];
		const l: number = Math.hypot(dx, dz) || 1;
		return [dx / l, dz / l];
	}

	/** Free to start a street here: on allowed ground and clear of streets of the same direction. */
	private valid(x: number, z: number, dir: 0 | 1, spacing: number): boolean {
		if (!this.allowed(x, z) || !this.field.sample(x, z)) return false;
		return this.hashes[dir].nearest(x, z, spacing) === null;
	}

	/** Grows a street from a seed one way. Returns the points after the seed and why it stopped. */
	private walk(seed: Vec2, dir: 0 | 1, sign: 1 | -1, pass: TracePass): { points: Vec2[]; closed: boolean } {
		const points: Vec2[] = [];
		const first: TensorSample | null = this.field.sample(seed[0], seed[1]);
		if (!first) return { points, closed: false };
		let heading: Vec2 = this.direction(first, dir);
		heading = [heading[0] * sign, heading[1] * sign];
		let p: Vec2 = seed;
		const maxSteps: number = Math.ceil(pass.maxLength / this.step / 2);
		const recent: number = Math.max(4, Math.ceil((2 * pass.spacing(seed[0], seed[1])) / this.step));
		for (let n: number = 0; n < maxSteps; n++) {
			const d: Vec2 | null = this.advance(p, dir, heading);
			if (!d) break;
			heading = d;
			const q: Vec2 = [p[0] + d[0] * this.step, p[1] + d[1] * this.step];
			if (!this.allowed(q[0], q[1])) break;
			const test: number = pass.spacing(q[0], q[1]) * 0.5;
			// Closing on its own earlier points means a ring: stop and let the graph join the ends.
			for (let i: number = 0; i < points.length - recent; i++) {
				if ((points[i][0] - q[0]) ** 2 + (points[i][1] - q[1]) ** 2 < test * test) {
					points.push(points[i]);
					return { points, closed: true };
				}
			}
			const hit: StreamPoint | null = this.hashes[dir].nearest(q[0], q[1], test);
			if (hit) {
				const other: Streamline = this.lines[hit.line];
				const a: Vec2 = other.points[Math.max(0, hit.index - 1)];
				const b: Vec2 = other.points[Math.min(other.points.length - 1, hit.index + 1)];
				const along: number = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
				const cos: number = Math.abs(dot(d, [(b[0] - a[0]) / along, (b[1] - a[1]) / along]));
				if (Math.acos(Math.min(1, cos)) >= pass.minJoinAngle) points.push([hit.x, hit.z]);
				break;
			}
			points.push(q);
			p = q;
		}
		return { points, closed: false };
	}

	private trace(seed: Vec2, pass: TracePass): Vec2[] {
		const forward = this.walk(seed, pass.dir, 1, pass);
		const backward = forward.closed ? { points: [] as Vec2[] } : this.walk(seed, pass.dir, -1, pass);
		return [...backward.points.reverse(), seed, ...forward.points];
	}

	/** Runs one pass. Streets already traced (of any pass) keep new streets of the same direction apart. */
	run(pass: TracePass): Streamline[] {
		const made: Streamline[] = [];
		const queue: Vec2[] = [];
		const b: TraceBounds = this.bounds;
		const grid: number = Math.max(pass.spacing((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2) * 1.6, this.step * 3);
		const starts: Vec2[] = [];
		for (let x: number = b.minX; x <= b.maxX; x += grid) {
			for (let z: number = b.minZ; z <= b.maxZ; z += grid) starts.push([x + this.rng.range(-0.4, 0.4) * grid, z + this.rng.range(-0.4, 0.4) * grid]);
		}
		for (let i: number = starts.length - 1; i > 0; i--) {
			const j: number = this.rng.int(0, i);
			[starts[i], starts[j]] = [starts[j], starts[i]];
		}
		queue.push(...starts);
		let guard: number = 0;
		while (queue.length > 0 && this.lines.length < MAX_LINES && guard++ < 20000) {
			const seed: Vec2 = queue.pop() as Vec2;
			const spacing: number = pass.spacing(seed[0], seed[1]);
			if (!this.valid(seed[0], seed[1], pass.dir, spacing)) continue;
			const points: Vec2[] = this.trace(seed, pass);
			if ((points.length - 1) * this.step < pass.minLength) continue;
			const line: Streamline = { id: this.lines.length, dir: pass.dir, rank: pass.rank, points };
			this.lines.push(line);
			made.push(line);
			points.forEach((pt: Vec2, index: number): void => this.hashes[pass.dir].add({ x: pt[0], z: pt[1], line: line.id, index }));
			// Next seeds sit one spacing to either side of the street, so lines fill the area evenly.
			const every: number = Math.max(1, Math.round(spacing / this.step));
			for (let i: number = 0; i < points.length; i += every) {
				const s: TensorSample | null = this.field.sample(points[i][0], points[i][1]);
				if (!s) continue;
				const side: Vec2 = pass.dir === 0 ? s.minor : s.major;
				const gap: number = pass.spacing(points[i][0], points[i][1]);
				queue.push([points[i][0] + side[0] * gap, points[i][1] + side[1] * gap], [points[i][0] - side[0] * gap, points[i][1] - side[1] * gap]);
			}
		}
		return made;
	}
}
