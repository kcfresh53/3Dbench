import type { Vec2 } from '../types';

/** A closed loop with gentle, seeded wobble: the centreline of a race circuit. */
export function circuitPoints(width: number, count: number, seed: number): Vec2[] {
	const points: Vec2[] = [];
	for (let i: number = 0; i < count; i++) {
		const t: number = (i / count) * Math.PI * 2;
		const radius: number = 1 + 0.08 * Math.sin(t * 3 + seed) + 0.04 * Math.sin(t * 5 + seed * 1.7);
		points.push([Math.cos(t) * width * 0.48 * radius, Math.sin(t) * width * 0.32 * radius]);
	}
	return points;
}
