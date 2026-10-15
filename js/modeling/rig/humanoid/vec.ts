export type Vec3 = [number, number, number];

export function add(a: Vec3, b: Vec3): Vec3 {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function sub(a: Vec3, b: Vec3): Vec3 {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function scale(a: Vec3, s: number): Vec3 {
	return [a[0] * s, a[1] * s, a[2] * s];
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
export function normalize(a: Vec3): Vec3 {
	const l: number = length(a);
	return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
}
export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
export function distance(a: Vec3, b: Vec3): number {
	return length(sub(a, b));
}
export function mirrorX(a: Vec3): Vec3 {
	return [-a[0], a[1], a[2]];
}
export function smoothstep(t: number): number {
	const c: number = Math.min(1, Math.max(0, t));
	return c * c * (3 - 2 * c);
}
