import { Vec2 } from './types';

function convexHull(points: Vec2[]): Vec2[] {
	const sorted: Vec2[] = points.slice().sort((a: Vec2, b: Vec2) => a[0] - b[0] || a[1] - b[1]);
	if (sorted.length < 3) return sorted;
	const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const lower: Vec2[] = [];
	for (const p of sorted) {
		while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
		lower.push(p);
	}
	const upper: Vec2[] = [];
	for (let i: number = sorted.length - 1; i >= 0; i--) {
		const p: Vec2 = sorted[i];
		while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
		upper.push(p);
	}
	lower.pop();
	upper.pop();
	return lower.concat(upper);
}

/** Angle in radians by which the points have to be rotated for their bounding box to have minimum area. */
export function minimumAreaRotation(points: Vec2[]): number {
	const hull: Vec2[] = convexHull(points);
	if (hull.length < 3) return 0;
	let best_angle: number = 0;
	let best_area: number = Infinity;
	for (let i: number = 0; i < hull.length; i++) {
		const a: Vec2 = hull[i];
		const b: Vec2 = hull[(i + 1) % hull.length];
		const angle: number = -Math.atan2(b[1] - a[1], b[0] - a[0]);
		const c: number = Math.cos(angle);
		const s: number = Math.sin(angle);
		let min_x: number = Infinity, max_x: number = -Infinity, min_y: number = Infinity, max_y: number = -Infinity;
		for (const p of hull) {
			const x: number = p[0] * c - p[1] * s;
			const y: number = p[0] * s + p[1] * c;
			min_x = Math.min(min_x, x); max_x = Math.max(max_x, x);
			min_y = Math.min(min_y, y); max_y = Math.max(max_y, y);
		}
		const area: number = (max_x - min_x) * (max_y - min_y);
		if (area < best_area - 1e-12) {
			best_area = area;
			best_angle = angle;
		}
	}
	return best_angle;
}
