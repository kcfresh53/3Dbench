import type { Vec2 } from './types';

/**
 * Oriented rectangle on the XZ plane. `ux, uz` is the unit direction of the width axis; the depth
 * axis is `(-uz, ux)`, so the frame is a pure rotation and never mirrors a building.
 */
export interface Obb {
	cx: number;
	cz: number;
	/** Half extent along the width axis. */
	hw: number;
	/** Half extent along the depth axis. */
	hd: number;
	ux: number;
	uz: number;
}

export function obbCorners(box: Obb): Vec2[] {
	const vx: number = -box.uz;
	const vz: number = box.ux;
	const out: Vec2[] = [];
	for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
		out.push([box.cx + box.ux * box.hw * a + vx * box.hd * b, box.cz + box.uz * box.hw * a + vz * box.hd * b]);
	}
	return out;
}

export function obbBounds(box: Obb): { minX: number; minZ: number; maxX: number; maxZ: number } {
	const ex: number = Math.abs(box.ux) * box.hw + Math.abs(box.uz) * box.hd;
	const ez: number = Math.abs(box.uz) * box.hw + Math.abs(box.ux) * box.hd;
	return { minX: box.cx - ex, minZ: box.cz - ez, maxX: box.cx + ex, maxZ: box.cz + ez };
}

/** Separating-axis overlap test. `margin` grows both boxes. */
export function obbOverlap(a: Obb, b: Obb, margin: number = 0): boolean {
	const axes: Vec2[] = [
		[a.ux, a.uz],
		[-a.uz, a.ux],
		[b.ux, b.uz],
		[-b.uz, b.ux],
	];
	const ca: Vec2[] = obbCorners(a);
	const cb: Vec2[] = obbCorners(b);
	for (const [ax, az] of axes) {
		let minA: number = Infinity;
		let maxA: number = -Infinity;
		let minB: number = Infinity;
		let maxB: number = -Infinity;
		for (const [x, z] of ca) {
			const p: number = x * ax + z * az;
			minA = Math.min(minA, p);
			maxA = Math.max(maxA, p);
		}
		for (const [x, z] of cb) {
			const p: number = x * ax + z * az;
			minB = Math.min(minB, p);
			maxB = Math.max(maxB, p);
		}
		if (maxA + margin < minB || maxB + margin < minA) return false;
	}
	return true;
}

export function pointInObb(box: Obb, x: number, z: number, margin: number = 0): boolean {
	const dx: number = x - box.cx;
	const dz: number = z - box.cz;
	const along: number = dx * box.ux + dz * box.uz;
	const across: number = -dx * box.uz + dz * box.ux;
	return Math.abs(along) <= box.hw + margin && Math.abs(across) <= box.hd + margin;
}

/** Distance from a point to a segment on the XZ plane. */
export function pointSegmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
	const dx: number = bx - ax;
	const dz: number = bz - az;
	const len2: number = dx * dx + dz * dz;
	const t: number = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
	return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Closest point on a segment, with the parameter along it. */
export function closestOnSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { x: number; z: number; t: number } {
	const dx: number = bx - ax;
	const dz: number = bz - az;
	const len2: number = dx * dx + dz * dz;
	const t: number = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
	return { x: ax + dx * t, z: az + dz * t, t };
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
	const o = (p: Vec2, q: Vec2, r: Vec2): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
	return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Shortest distance between an oriented box and a segment; 0 when they touch or overlap. */
export function obbSegmentDistance(box: Obb, ax: number, az: number, bx: number, bz: number): number {
	if (pointInObb(box, ax, az) || pointInObb(box, bx, bz)) return 0;
	const corners: Vec2[] = obbCorners(box);
	let best: number = Infinity;
	for (let i: number = 0; i < 4; i++) {
		const c: Vec2 = corners[i];
		const d: Vec2 = corners[(i + 1) % 4];
		if (segmentsCross([ax, az], [bx, bz], c, d)) return 0;
		best = Math.min(best, pointSegmentDistance(c[0], c[1], ax, az, bx, bz));
		best = Math.min(best, pointSegmentDistance(ax, az, c[0], c[1], d[0], d[1]), pointSegmentDistance(bx, bz, c[0], c[1], d[0], d[1]));
	}
	return best;
}

export function pointInPolygon(x: number, z: number, polygon: Vec2[]): boolean {
	let inside: boolean = false;
	for (let i: number = 0, j: number = polygon.length - 1; i < polygon.length; j = i++) {
		const a: Vec2 = polygon[i];
		const b: Vec2 = polygon[j];
		if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
	}
	return inside;
}

/** Yaw (rotation about +Y, Three.js convention) that maps local +X onto the width axis. */
export function yawOf(box: { ux: number; uz: number }): number {
	return Math.atan2(-box.uz, box.ux);
}

/** World position of a point given in a box's local frame (x along width, z along depth). */
export function localToWorld(box: { cx: number; cz: number; ux: number; uz: number }, x: number, z: number): Vec2 {
	return [box.cx + box.ux * x - box.uz * z, box.cz + box.uz * x + box.ux * z];
}
