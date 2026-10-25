import type { Vec3 } from './types';

export interface Frame {
	/** First radial axis. */
	u: Vec3;
	/** Second radial axis, always cross(direction, u). */
	v: Vec3;
	direction: Vec3;
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
	lerp(a[0], b[0], t),
	lerp(a[1], b[1], t),
	lerp(a[2], b[2], t),
];
export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
export const degToRad = (deg: number): number => (deg * Math.PI) / 180;

export function normalize(a: Vec3): Vec3 {
	const l: number = length(a);
	if (l < 1e-9) return [0, 1, 0];
	return [a[0] / l, a[1] / l, a[2] / l];
}

/** Any unit vector perpendicular to `direction`. */
export function perpendicular(direction: Vec3): Vec3 {
	const reference: Vec3 = Math.abs(direction[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
	return normalize(cross(direction, reference));
}

/** Rodrigues rotation of `v` around `axis` by `angle` radians. */
export function rotateAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
	const k: Vec3 = normalize(axis);
	const c: number = Math.cos(angle);
	const s: number = Math.sin(angle);
	return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

/** Parallel-transport frames along a polyline, so rings never twist. */
export function transportFrames(points: Vec3[]): Frame[] {
	const last: number = points.length - 1;
	const frames: Frame[] = [];
	let previousU: Vec3 = [0, 0, 0];
	for (let i = 0; i <= last; i++) {
		let direction: Vec3;
		if (i === 0) direction = normalize(sub(points[1], points[0]));
		else if (i === last) direction = normalize(sub(points[last], points[last - 1]));
		else direction = normalize(sub(points[i + 1], points[i - 1]));

		let u: Vec3;
		if (i === 0) {
			u = perpendicular(direction);
		} else {
			u = normalize(sub(previousU, scale(direction, dot(previousU, direction))));
		}
		previousU = u;
		frames.push({ u, v: cross(direction, u), direction });
	}
	return frames;
}
