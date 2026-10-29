import { round } from '../math';
import type { RoadCorridor, RoadJunction, RoadSample, RoadSet } from './corridor';

/** One road segment as a game reads it: a centreline to follow and what kind of road it is. */
export interface ManifestRoad {
	id: string;
	profile: string;
	structure: 'ground' | 'bridge' | 'tunnel' | 'air';
	lanes: number;
	laneWidth: number;
	/** Full width of the cross-section, kerb to kerb including pavements, metres. */
	width: number;
	oneWay: boolean;
	length: number;
	/** Junction ids at the start and end of `points`. */
	from: string;
	to: string;
	/** Centreline as [x, y, z] in metres, in the direction of travel for one-way roads. */
	points: number[][];
}

export interface ManifestJunction {
	id: string;
	position: number[];
	/** Roads meeting here. */
	degree: number;
}

export interface RoadsExport {
	roads: ManifestRoad[];
	junctions: ManifestJunction[];
}

/** Distance from `p` to the segment `a`..`b` in 3D. */
function distanceToSegment(p: RoadSample, a: RoadSample, b: RoadSample): number {
	const abx: number = b.x - a.x;
	const aby: number = b.y - a.y;
	const abz: number = b.z - a.z;
	const len2: number = abx * abx + aby * aby + abz * abz;
	const t: number = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2));
	return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t), p.z - (a.z + abz * t));
}

/**
 * Douglas-Peucker: keeps the points that matter so a long gentle curve is a handful of points instead of
 * one every few metres. `tolerance` is the largest distance, in metres, the result may stray from the road.
 */
export function simplifyCentreline(points: RoadSample[], tolerance: number): RoadSample[] {
	if (points.length <= 2) return points.slice();
	const keep: boolean[] = new Array<boolean>(points.length).fill(false);
	keep[0] = true;
	keep[points.length - 1] = true;
	const stack: Array<[number, number]> = [[0, points.length - 1]];
	while (stack.length > 0) {
		const [lo, hi] = stack.pop() as [number, number];
		let worst: number = -1;
		let worstAt: number = -1;
		for (let i: number = lo + 1; i < hi; i++) {
			const d: number = distanceToSegment(points[i], points[lo], points[hi]);
			if (d > worst) {
				worst = d;
				worstAt = i;
			}
		}
		if (worst > tolerance && worstAt > 0) {
			keep[worstAt] = true;
			stack.push([lo, worstAt], [worstAt, hi]);
		}
	}
	return points.filter((_p: RoadSample, i: number): boolean => keep[i]);
}

function r2(n: number): number {
	return round(n, 2);
}

/** Describes the road network as plain data an engine can use for traffic, signs, splines and navigation. */
export function exportRoads(set: RoadSet, tolerance: number = 0.15): RoadsExport {
	const roads: ManifestRoad[] = set.corridors.map((c: RoadCorridor): ManifestRoad => ({
		id: c.id,
		profile: c.profile,
		structure: c.structure,
		lanes: c.lanes,
		laneWidth: r2(c.laneWidth),
		width: r2(c.leftExtent + c.rightExtent),
		oneWay: c.oneWay,
		length: r2(c.length),
		from: c.startNode,
		to: c.endNode,
		points: simplifyCentreline(c.points, tolerance).map((p: RoadSample): number[] => [r2(p.x), r2(p.y), r2(p.z)]),
	}));
	const junctions: ManifestJunction[] = set.junctions
		.filter((j: RoadJunction): boolean => !j.id.startsWith('roundabout:'))
		.map((j: RoadJunction): ManifestJunction => ({ id: j.id, position: [r2(j.x), r2(j.y), r2(j.z)], degree: j.degree }));
	return { roads, junctions };
}
