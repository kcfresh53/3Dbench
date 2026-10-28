import type { RoadNetwork, RoadNode, RoadProfile, RoadSegment } from '../../../../roadscape/src/core/model';
import { buildIndex, classifyNode, resolveProfileData, segmentCurve } from '../../../../roadscape/src/core/network';
import type { NetworkIndex } from '../../../../roadscape/src/core/network';
import { resolveProfile } from '../../../../roadscape/src/core/profile_resolve';
import type { ResolvedProfile } from '../../../../roadscape/src/core/profile_resolve';
import type { RoadCurve } from '../../../../roadscape/src/core/curve';
import type { Vec3 } from '../types';
import { SpatialHash } from '../grid';
import { pointSegmentDistance } from '../geometry2d';

export type RoadStructure = 'ground' | 'bridge' | 'tunnel';

export interface RoadSample {
	x: number;
	y: number;
	z: number;
}

/** One road segment as the city sees it: a centreline in metres and how wide the whole cross-section is. */
export interface RoadCorridor {
	id: string;
	profile: string;
	points: RoadSample[];
	/** Distance from the centreline to the outer edge of everything on the left, metres. */
	leftExtent: number;
	rightExtent: number;
	/** Half the carriageway (lanes plus median), metres. */
	carriageHalf: number;
	lanes: number;
	structure: RoadStructure;
	length: number;
	startNode: string;
	endNode: string;
}

export interface RoadJunction {
	id: string;
	x: number;
	y: number;
	z: number;
	/** Metres around the point that lots must keep clear. */
	radius: number;
	degree: number;
}

export interface RoadSet {
	corridors: RoadCorridor[];
	junctions: RoadJunction[];
}

export function emptyRoadSet(): RoadSet {
	return { corridors: [], junctions: [] };
}

export interface CorridorOptions {
	/** Converts a point in network space to city metres. */
	toCity: (p: Vec3) => Vec3;
	/** Scale from network model units to city metres after `toCity` (for non-uniform unit setups). */
	lengthScale: number;
	/** Ground height of the city terrain at a position, used to tell bridges and tunnels apart. */
	terrainHeight: (x: number, z: number) => number;
	/** Maximum distance between centreline samples, metres. */
	sampleSpacing: number;
	/**
	 * Roads whose automatic structure is undecided count as ground-level while their mean height stays
	 * within this many metres of the terrain; beyond it they become bridges or tunnels. When left out,
	 * Roadscape's own thresholds decide.
	 */
	groundTolerance?: number;
}

export const DEFAULT_CORRIDOR_OPTIONS: Pick<CorridorOptions, 'lengthScale' | 'sampleSpacing'> = { lengthScale: 1, sampleSpacing: 3 };

function structureOf(segment: RoadSegment, profile: RoadProfile, samples: RoadSample[], network: RoadNetwork, terrainHeight: (x: number, z: number) => number, groundTolerance: number | undefined): RoadStructure {
	if (segment.structure !== 'auto') return segment.structure;
	if (profile.structure !== 'auto') return profile.structure;
	let total: number = 0;
	for (const p of samples) total += p.y - terrainHeight(p.x, p.z);
	const mean: number = samples.length > 0 ? total / samples.length : 0;
	if (groundTolerance !== undefined) return mean > groundTolerance ? 'bridge' : mean < -groundTolerance ? 'tunnel' : 'ground';
	if (mean > network.settings.structures.bridgeThreshold) return 'bridge';
	if (mean < -network.settings.structures.tunnelThreshold) return 'tunnel';
	return 'ground';
}

/** Converts a Roadscape network into corridors and junction clearances in city metres. */
export function roadSetFromNetwork(network: RoadNetwork, options: CorridorOptions): RoadSet {
	const index: NetworkIndex = buildIndex(network);
	const unit: number = network.settings.unitsPerMeter;
	const scale: number = options.lengthScale / unit;
	const corridors: RoadCorridor[] = [];
	const extentByNode: Map<string, number> = new Map();
	for (const segment of network.segments.values()) {
		const profile: RoadProfile = resolveProfileData(network, segment.profile);
		const resolved: ResolvedProfile = resolveProfile(profile, unit, network.settings.weather);
		const curve: RoadCurve = segmentCurve(network, index, segment);
		const step: number = Math.max(0.5, options.sampleSpacing) / scale;
		const raw: Vec3[] = curve.polyline(step);
		const samples: RoadSample[] = raw.map((p: Vec3): RoadSample => {
			const q: Vec3 = options.toCity(p);
			return { x: q[0], y: q[1], z: q[2] };
		});
		let length: number = 0;
		for (let i: number = 1; i < samples.length; i++) length += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
		const leftExtent: number = resolved.extent.left * scale;
		const rightExtent: number = resolved.extent.right * scale;
		const reach: number = Math.max(leftExtent, rightExtent);
		extentByNode.set(segment.a, Math.max(extentByNode.get(segment.a) ?? 0, reach));
		extentByNode.set(segment.b, Math.max(extentByNode.get(segment.b) ?? 0, reach));
		corridors.push({
			id: segment.key,
			profile: profile.id,
			points: samples,
			leftExtent,
			rightExtent,
			carriageHalf: resolved.half * scale,
			lanes: profile.carriageway.lanes,
			structure: structureOf(segment, profile, samples, network, options.terrainHeight, options.groundTolerance),
			length,
			startNode: segment.a,
			endNode: segment.b,
		});
	}
	const junctions: RoadJunction[] = [];
	const cornerRadius: number = network.settings.junction.cornerRadius * options.lengthScale / unit;
	for (const node of network.nodes.values() as IterableIterator<RoadNode>) {
		const kind: string = classifyNode(network, index, node.id);
		if (kind === 'isolated' || kind === 'through') continue;
		const q: Vec3 = options.toCity(node.position);
		const reach: number = extentByNode.get(node.id) ?? 4;
		junctions.push({
			id: node.id,
			x: q[0],
			y: q[1],
			z: q[2],
			radius: reach + (kind === 'junction' ? cornerRadius : 0) + 1,
			degree: index.incident.get(node.id)?.length ?? 0,
		});
	}
	return { corridors, junctions };
}

/** Merges several networks (one per Roadscape mesh in the project). */
export function mergeRoadSets(sets: RoadSet[]): RoadSet {
	return { corridors: sets.flatMap((s: RoadSet): RoadCorridor[] => s.corridors), junctions: sets.flatMap((s: RoadSet): RoadJunction[] => s.junctions) };
}

export interface RoadSegmentRef {
	road: RoadCorridor;
	index: number;
	ax: number;
	az: number;
	bx: number;
	bz: number;
}

/** Spatial index over every ground-level road segment. Bridges and tunnels do not block lots. */
export class RoadIndex {
	private readonly hash: SpatialHash<RoadSegmentRef> = new SpatialHash<RoadSegmentRef>(24);

	constructor(readonly roads: RoadSet) {
		for (const road of roads.corridors) {
			if (road.structure !== 'ground') continue;
			const reach: number = Math.max(road.leftExtent, road.rightExtent) + 2;
			for (let i: number = 0; i + 1 < road.points.length; i++) {
				const a: RoadSample = road.points[i];
				const b: RoadSample = road.points[i + 1];
				this.hash.insert(
					{ road, index: i, ax: a.x, az: a.z, bx: b.x, bz: b.z },
					Math.min(a.x, b.x) - reach,
					Math.min(a.z, b.z) - reach,
					Math.max(a.x, b.x) + reach,
					Math.max(a.z, b.z) + reach,
				);
			}
		}
	}

	nearby(minX: number, minZ: number, maxX: number, maxZ: number): RoadSegmentRef[] {
		return this.hash.query(minX, minZ, maxX, maxZ);
	}

	/** Distance to the nearest road edge (centreline distance minus that side's extent). Negative inside a corridor. */
	clearance(x: number, z: number, search: number = 40): number {
		let best: number = Infinity;
		for (const seg of this.nearby(x - search, z - search, x + search, z + search)) {
			const d: number = pointSegmentDistance(x, z, seg.ax, seg.az, seg.bx, seg.bz);
			const side: number = (seg.bx - seg.ax) * (z - seg.az) - (seg.bz - seg.az) * (x - seg.ax);
			const extent: number = side > 0 ? seg.road.rightExtent : seg.road.leftExtent;
			best = Math.min(best, d - extent);
		}
		return best;
	}
}
