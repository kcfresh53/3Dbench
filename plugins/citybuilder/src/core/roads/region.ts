import { pointInPolygon, pointSegmentDistance } from '../geometry2d';
import type { Vec2 } from '../types';
import type { RegionTest } from './road_paint';

/** Everything within `radius` metres of a stroke drawn with a round brush. */
export function strokeRegion(stroke: Vec2[], radius: number): RegionTest {
	return (x: number, z: number): boolean => {
		if (stroke.length === 1) return Math.hypot(x - stroke[0][0], z - stroke[0][1]) <= radius;
		for (let i: number = 0; i + 1 < stroke.length; i++) {
			if (pointSegmentDistance(x, z, stroke[i][0], stroke[i][1], stroke[i + 1][0], stroke[i + 1][1]) <= radius) return true;
		}
		return false;
	};
}

export function rectRegion(x0: number, z0: number, x1: number, z1: number): RegionTest {
	const minX: number = Math.min(x0, x1);
	const maxX: number = Math.max(x0, x1);
	const minZ: number = Math.min(z0, z1);
	const maxZ: number = Math.max(z0, z1);
	return (x: number, z: number): boolean => x >= minX && x <= maxX && z >= minZ && z <= maxZ;
}

export function polygonRegion(polygon: Vec2[]): RegionTest {
	return (x: number, z: number): boolean => polygon.length >= 3 && pointInPolygon(x, z, polygon);
}

/** Bounds of a stroke grown by the brush radius, for skipping roads far from the stroke. */
export function strokeBounds(stroke: Vec2[], radius: number): { minX: number; minZ: number; maxX: number; maxZ: number } {
	let minX: number = Infinity;
	let minZ: number = Infinity;
	let maxX: number = -Infinity;
	let maxZ: number = -Infinity;
	for (const p of stroke) {
		minX = Math.min(minX, p[0] - radius);
		maxX = Math.max(maxX, p[0] + radius);
		minZ = Math.min(minZ, p[1] - radius);
		maxZ = Math.max(maxZ, p[1] + radius);
	}
	return { minX, minZ, maxX, maxZ };
}
