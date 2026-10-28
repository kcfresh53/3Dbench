import type { Vec3 } from '../types';
import { Heightfield } from './heightfield';

export interface RayHit {
	point: Vec3;
	distance: number;
}

/**
 * Intersects a ray with the terrain by marching in cell-sized steps, then bisecting the crossing.
 * Returns null when the ray misses the map or never dips below the ground inside it.
 */
export function raycastHeightfield(hf: Heightfield, origin: Vec3, direction: Vec3, maxDistance: number = 20000): RayHit | null {
	const len: number = Math.hypot(direction[0], direction[1], direction[2]);
	if (len < 1e-9) return null;
	const d: Vec3 = [direction[0] / len, direction[1] / len, direction[2] / len];
	const step: number = Math.max(0.25, hf.cellSize * 0.5);
	const above = (t: number): number => {
		const x: number = origin[0] + d[0] * t;
		const y: number = origin[1] + d[1] * t;
		const z: number = origin[2] + d[2] * t;
		return y - hf.sample(x, z);
	};
	let previousT: number = 0;
	let previous: number = above(0);
	for (let t: number = step; t <= maxDistance; t += step) {
		const x: number = origin[0] + d[0] * t;
		const z: number = origin[2] + d[2] * t;
		const margin: number = hf.cellSize * 2;
		const near: boolean = x >= hf.originX - margin && x <= hf.originX + hf.width + margin && z >= hf.originZ - margin && z <= hf.originZ + hf.depth + margin;
		const current: number = above(t);
		if (previous > 0 && current <= 0 && near) {
			let lo: number = previousT;
			let hi: number = t;
			for (let i: number = 0; i < 24; i++) {
				const mid: number = (lo + hi) / 2;
				if (above(mid) > 0) lo = mid;
				else hi = mid;
			}
			const hit: number = (lo + hi) / 2;
			const px: number = origin[0] + d[0] * hit;
			const pz: number = origin[2] + d[2] * hit;
			if (!hf.containsWorld(px, pz)) return null;
			return { point: [px, hf.sample(px, pz), pz], distance: hit };
		}
		previousT = t;
		previous = current;
	}
	return null;
}

/** Intersects a ray with a horizontal plane, for aiming at ground that is below the map or flat. */
export function raycastPlane(origin: Vec3, direction: Vec3, height: number): Vec3 | null {
	if (Math.abs(direction[1]) < 1e-9) return null;
	const t: number = (height - origin[1]) / direction[1];
	if (t < 0) return null;
	return [origin[0] + direction[0] * t, height, origin[2] + direction[2] * t];
}
