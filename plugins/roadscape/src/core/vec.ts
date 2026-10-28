import type { Vec2, Vec3 } from './types';

export function add(a: Vec3, b: Vec3): Vec3 {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
	return [a[0] * s, a[1] * s, a[2] * s];
}

export function mix(a: Vec3, b: Vec3, t: number): Vec3 {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function dot(a: Vec3, b: Vec3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function length(a: Vec3): number {
	return Math.hypot(a[0], a[1], a[2]);
}

export function distance(a: Vec3, b: Vec3): number {
	return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Horizontal (XZ) distance, ignoring height. */
export function distanceXZ(a: Vec3, b: Vec3): number {
	return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

export function normalize(a: Vec3): Vec3 {
	const l: number = length(a);
	return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}

export function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, n));
}

export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
	const t: number = clamp((x - edge0) / (edge1 - edge0 || 1e-9), 0, 1);
	return t * t * (3 - 2 * t);
}

export function round5(n: number): number {
	return Math.round(n * 1e5) / 1e5;
}

export function roundVec(a: Vec3): Vec3 {
	return [round5(a[0]), round5(a[1]), round5(a[2])];
}

/** Unit horizontal direction of a vector, or null when it points (almost) straight up or down. */
export function flatDirection(a: Vec3): Vec3 | null {
	const h: number = Math.hypot(a[0], a[2]);
	return h < 1e-9 ? null : [a[0] / h, 0, a[2] / h];
}

/** The true right-hand side of a horizontal forward direction seen from above, Y up. */
export function rightOf(forward: Vec3): Vec3 {
	return [-forward[2], 0, forward[0]];
}

/** 2D cross product on the XZ plane. */
export function cross2(a: Vec3, b: Vec3): number {
	return a[0] * b[2] - a[2] * b[0];
}

/**
 * Intersection of two horizontal lines `p + t*d` and `q + u*e`.
 * Returns the two parameters or null when the lines are (almost) parallel.
 */
export function intersectLinesXZ(p: Vec3, d: Vec3, q: Vec3, e: Vec3): [number, number] | null {
	const det: number = cross2(d, e);
	if (Math.abs(det) < 1e-9) return null;
	const w: Vec3 = [q[0] - p[0], 0, q[2] - p[2]];
	return [cross2(w, e) / det, cross2(w, d) / det];
}

export function rotateYaw(v: Vec3, yaw: number): Vec3 {
	const c: number = Math.cos(yaw);
	const s: number = Math.sin(yaw);
	return [v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c];
}

export function vec2(a: Vec3): Vec2 {
	return [a[0], a[2]];
}

/** Signed area of a polygon on the XZ plane (positive when counter-clockwise in X right, Z up). */
export function polygonAreaXZ(points: Vec3[]): number {
	let area: number = 0;
	for (let i: number = 0; i < points.length; i++) {
		const a: Vec3 = points[i];
		const b: Vec3 = points[(i + 1) % points.length];
		area += a[0] * b[2] - b[0] * a[2];
	}
	return area / 2;
}
