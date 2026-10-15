/**
 * Dependency free vector and quaternion helpers for the IK rig.
 * Quaternions are stored as [x, y, z, w] (same layout as THREE.Quaternion).
 */
import { Vec3, add, sub, scale, dot, cross, length, normalize, lerp, distance, smoothstep } from '../../../modeling/rig/humanoid/vec';

export type { Vec3 };
export { add, sub, scale, dot, cross, length, normalize, lerp, distance, smoothstep };

export type Quat = [number, number, number, number];

export const EPSILON: number = 1e-9;
export const QUAT_IDENTITY: Readonly<Quat> = [0, 0, 0, 1];

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function quatIdentity(): Quat {
	return [0, 0, 0, 1];
}

export function quatClone(q: Quat): Quat {
	return [q[0], q[1], q[2], q[3]];
}

export function quatMul(a: Quat, b: Quat): Quat {
	return [
		a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
		a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
		a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
		a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
	];
}

export function quatConjugate(q: Quat): Quat {
	return [-q[0], -q[1], -q[2], q[3]];
}

export function quatNormalize(q: Quat): Quat {
	const l: number = Math.hypot(q[0], q[1], q[2], q[3]);
	if (l < EPSILON) return [0, 0, 0, 1];
	return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export function quatDot(a: Quat, b: Quat): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

/** Rotates a vector by a unit quaternion */
export function quatRotate(q: Quat, v: Vec3): Vec3 {
	const u: Vec3 = [q[0], q[1], q[2]];
	const t: Vec3 = scale(cross(u, v), 2);
	return add(add(v, scale(t, q[3])), cross(u, t));
}

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
	const a: Vec3 = normalize(axis);
	const s: number = Math.sin(angle / 2);
	return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)];
}

/** Shortest rotation taking direction `from` onto direction `to` */
export function quatFromTo(from: Vec3, to: Vec3): Quat {
	const a: Vec3 = normalize(from);
	const b: Vec3 = normalize(to);
	const d: number = dot(a, b);
	if (d > 1 - 1e-12) return quatIdentity();
	if (d < -1 + 1e-12) {
		// opposite directions: rotate 180 degrees around any perpendicular axis
		let axis: Vec3 = cross([1, 0, 0], a);
		if (length(axis) < 1e-6) axis = cross([0, 1, 0], a);
		return quatFromAxisAngle(axis, Math.PI);
	}
	const c: Vec3 = cross(a, b);
	return quatNormalize([c[0], c[1], c[2], 1 + d]);
}

export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
	let cos: number = quatDot(a, b);
	let target: Quat = b;
	if (cos < 0) {
		cos = -cos;
		target = [-b[0], -b[1], -b[2], -b[3]];
	}
	if (cos > 0.9995) {
		return quatNormalize([
			a[0] + (target[0] - a[0]) * t,
			a[1] + (target[1] - a[1]) * t,
			a[2] + (target[2] - a[2]) * t,
			a[3] + (target[3] - a[3]) * t,
		]);
	}
	const theta: number = Math.acos(cos);
	const sin: number = Math.sin(theta);
	const wa: number = Math.sin((1 - t) * theta) / sin;
	const wb: number = Math.sin(t * theta) / sin;
	return [a[0] * wa + target[0] * wb, a[1] * wa + target[1] * wb, a[2] * wa + target[2] * wb, a[3] * wa + target[3] * wb];
}

/** Partial application of a rotation: slerp from identity */
export function quatScaleAngle(q: Quat, factor: number): Quat {
	return quatSlerp(QUAT_IDENTITY as Quat, q, factor);
}

/** Rotation angle of a quaternion in radians (0..PI) */
export function quatAngle(q: Quat): number {
	return 2 * Math.acos(clamp(Math.abs(q[3]), 0, 1));
}

/** Angle between two unit vectors in radians */
export function angleBetween(a: Vec3, b: Vec3): number {
	return Math.acos(clamp(dot(normalize(a), normalize(b)), -1, 1));
}

/** Component of v perpendicular to the unit axis */
export function projectOnPlane(v: Vec3, normal: Vec3): Vec3 {
	return sub(v, scale(normal, dot(v, normal)));
}

/** Splits q into a swing and a twist rotation around the (unit) axis: q = swing * twist */
export function quatSwingTwist(q: Quat, axis: Vec3): { swing: Quat; twist: Quat } {
	const projection: Vec3 = scale(axis, dot([q[0], q[1], q[2]], axis));
	const twist: Quat = quatNormalize([projection[0], projection[1], projection[2], q[3]]);
	const swing: Quat = quatMul(q, quatConjugate(twist));
	return { swing, twist };
}

export function vecApproxEqual(a: Vec3, b: Vec3, tolerance: number = 1e-6): boolean {
	return distance(a, b) <= tolerance;
}

/** Critically damped smoothing step (Unity style SmoothDamp). `velocity` is carried by the caller. */
export function smoothDamp(current: number, target: number, velocity: { value: number }, smooth_time: number, dt: number): number {
	const omega: number = 2 / Math.max(1e-4, smooth_time);
	const x: number = omega * dt;
	const exp: number = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
	const change: number = current - target;
	const temp: number = (velocity.value + omega * change) * dt;
	velocity.value = (velocity.value - omega * temp) * exp;
	return target + (change + temp) * exp;
}
