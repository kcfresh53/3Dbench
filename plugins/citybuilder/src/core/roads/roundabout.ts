import type { RoadNetwork, RoadNode, RoadProfile, RoadSegment, Structure } from '../../../../roadscape/src/core/model';
import { buildIndex, addSegment, removeNode, segmentCurve } from '../../../../roadscape/src/core/network';
import type { NetworkIndex } from '../../../../roadscape/src/core/network';
import { splitSegmentAt } from '../../../../roadscape/src/core/network_edit';
import type { IdFactory } from '../../../../roadscape/src/core/network_edit';
import { resolveProfileData } from '../../../../roadscape/src/core/network';
import type { RoadCurve } from '../../../../roadscape/src/core/curve';
import type { Vec3 } from '../types';

export interface RoundaboutOptions {
	/** Centreline radius of the ring, in network (model) units. */
	radius: number;
	/** Profile of the ring. `auto` forks the busiest arm's profile without crosswalks or a centre line. */
	profile: string;
	/** Largest angle one ring segment may span, radians. Wider gaps get extra points. */
	maxArc: number;
	/** Arms must keep at least this much road beyond the ring, in model units. */
	minArm: number;
	/** Which way traffic circulates: `right` is anticlockwise seen from above. */
	hand: 'right' | 'left';
}

export const DEFAULT_ROUNDABOUT: Omit<RoundaboutOptions, 'radius'> = { profile: 'auto', maxArc: (75 * Math.PI) / 180, minArm: 2, hand: 'right' };

export interface RoundaboutResult {
	/** Centre of the roundabout in network space. */
	center: Vec3;
	radius: number;
	/** Ring points in travel order. */
	ring: string[];
	/** Ring segment keys in travel order. */
	segments: string[];
	/** The profile used for the ring. */
	profile: string;
}

interface Arm {
	segment: RoadSegment;
	/** Node of the arm's far side after the split, on the ring. */
	ringNode: string;
}

function horizontal(a: Vec3, b: Vec3): number {
	return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

/** Arc length from `from` (a curve end) at which the curve first crosses `radius` metres from `center`. */
function crossing(curve: RoadCurve, center: Vec3, radius: number, fromStart: boolean): number | null {
	const L: number = curve.length;
	const at = (s: number): number => horizontal(curve.pointAt(curve.tAtDistance(fromStart ? s : L - s)), center);
	if (at(L) < radius) return null;
	let lo: number = 0;
	let hi: number = L;
	for (let i: number = 0; i < 40; i++) {
		const mid: number = (lo + hi) / 2;
		if (at(mid) < radius) lo = mid;
		else hi = mid;
	}
	return hi;
}

/** The profile most arms use; used to name and fork the ring profile. */
function busiestProfile(arms: RoadSegment[]): string {
	const votes: Map<string, number> = new Map();
	for (const a of arms) votes.set(a.profile, (votes.get(a.profile) ?? 0) + 1);
	return [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function ringProfileFor(network: RoadNetwork, requested: string, arms: RoadSegment[]): string {
	if (requested !== 'auto') return requested;
	const base: string = busiestProfile(arms);
	const id: string = `${base}_ring`;
	if (!network.profiles.has(id)) {
		const source: RoadProfile = resolveProfileData(network, base);
		network.profiles.set(id, {
			...source,
			id,
			name: `${source.name} (roundabout ring)`,
			builtin: false,
			carriageway: { ...source.carriageway, centerMarking: 'none', crosswalks: 'none', medianWidth: 0, medianBarrier: false, laneMarking: source.carriageway.lanes > 2 ? 'dashed' : 'none' },
		});
	}
	return id;
}

function structureOf(arms: RoadSegment[]): Structure {
	const votes: Map<Structure, number> = new Map();
	for (const a of arms) votes.set(a.structure, (votes.get(a.structure) ?? 0) + 1);
	return [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Replaces a junction with a roundabout. Every road is cut where it meets a circle around the junction;
 * the part inside is removed and the cut points are joined by a ring of circular arcs. The ring is made of
 * ordinary Roadscape segments, so it can be restyled, split or reshaped like any other road.
 */
export function makeRoundabout(network: RoadNetwork, nodeId: string, options: RoundaboutOptions, ids: IdFactory): RoundaboutResult {
	const centerNode: RoadNode | undefined = network.nodes.get(nodeId);
	if (!centerNode) throw new Error('That junction no longer exists.');
	const center: Vec3 = [centerNode.position[0], centerNode.position[1], centerNode.position[2]];
	const index: NetworkIndex = buildIndex(network);
	const incident: RoadSegment[] = [...(index.incident.get(nodeId) ?? [])];
	if (incident.length === 0) throw new Error('Pick a junction with at least one road.');
	const radius: number = options.radius;
	const profile: string = ringProfileFor(network, options.profile, incident);
	const structure: Structure = structureOf(incident);

	// Check every arm first so a refusal leaves the network untouched.
	const cuts: Array<{ segment: RoadSegment; along: number }> = [];
	for (const segment of incident) {
		const curve: RoadCurve = segmentCurve(network, index, segment);
		const fromStart: boolean = segment.a === nodeId;
		const s: number | null = crossing(curve, center, radius, fromStart);
		if (s === null || curve.length - s < options.minArm) throw new Error(`A road at this junction is too short for a roundabout of this size. Shrink the radius or lengthen the road.`);
		cuts.push({ segment, along: fromStart ? s : curve.length - s });
	}

	const arms: Arm[] = [];
	for (const cut of cuts) {
		const fromStart: boolean = cut.segment.a === nodeId;
		const split = splitSegmentAt(network, cut.segment.key, cut.along, ids());
		const inner: RoadSegment = fromStart ? split.first : split.second;
		network.segments.delete(inner.key);
		const node: RoadNode = split.node;
		// Snap the cut point exactly onto the circle.
		const angle: number = Math.atan2(node.position[2] - center[2], node.position[0] - center[0]);
		node.position = [center[0] + Math.cos(angle) * radius, node.position[1], center[2] + Math.sin(angle) * radius];
		arms.push({ segment: fromStart ? split.second : split.first, ringNode: node.id });
	}
	removeNode(network, nodeId);

	const height: number = arms.reduce((sum: number, a: Arm): number => sum + (network.nodes.get(a.ringNode) as RoadNode).position[1], 0) / arms.length;
	const angleOf = (id: string): number => {
		const p: Vec3 = (network.nodes.get(id) as RoadNode).position;
		return Math.atan2(p[2] - center[2], p[0] - center[0]);
	};
	for (const arm of arms) (network.nodes.get(arm.ringNode) as RoadNode).position[1] = height;

	// Ring points in increasing angle, with extra points wherever two arms are too far apart for one arc.
	const turn: number = Math.PI * 2;
	const sorted: Array<{ id: string; angle: number }> = arms.map((a: Arm): { id: string; angle: number } => ({ id: a.ringNode, angle: angleOf(a.ringNode) })).sort((a, b) => a.angle - b.angle);
	const points: Array<{ id: string; angle: number }> = [];
	sorted.forEach((p: { id: string; angle: number }, i: number): void => {
		points.push(p);
		const next: number = i + 1 < sorted.length ? sorted[i + 1].angle : sorted[0].angle + turn;
		const gap: number = next - p.angle;
		const extra: number = Math.max(0, Math.ceil(gap / options.maxArc) - 1);
		for (let k: number = 1; k <= extra; k++) {
			const a: number = p.angle + (gap * k) / (extra + 1);
			const node: RoadNode = addRingNode(network, ids, center, radius, a, height);
			points.push({ id: node.id, angle: a });
		}
	});
	const ordered: Array<{ id: string; angle: number }> = options.hand === 'right' ? points : [...points].reverse();
	const direction: number = options.hand === 'right' ? 1 : -1;
	const keys: string[] = [];
	for (let i: number = 0; i < ordered.length; i++) {
		const from = ordered[i];
		const to = ordered[(i + 1) % ordered.length];
		// The signed arc swept going this way round, always positive.
		let sweep: number = direction * (to.angle - from.angle);
		while (sweep <= 1e-9) sweep += turn;
		while (sweep > turn + 1e-9) sweep -= turn;
		if (ordered.length === 1) sweep = turn;
		const k: number = (4 / 3) * Math.tan(sweep / 4) * radius;
		const tangent = (a: number): Vec3 => [-Math.sin(a) * direction, 0, Math.cos(a) * direction];
		const ta: Vec3 = tangent(from.angle);
		const tb: Vec3 = tangent(to.angle);
		// addSegment orders the two nodes by id and swaps the handles to match.
		const segment: RoadSegment = addSegment(network, from.id, to.id, {
			profile,
			structure,
			smooth: true,
			handleA: [ta[0] * k, 0, ta[2] * k],
			handleB: [-tb[0] * k, 0, -tb[2] * k],
		});
		keys.push(segment.key);
	}
	return { center, radius, ring: ordered.map((p) => p.id), segments: keys, profile };
}

function addRingNode(network: RoadNetwork, ids: IdFactory, center: Vec3, radius: number, angle: number, height: number): RoadNode {
	const id: string = ids();
	const node: RoadNode = { id, position: [center[0] + Math.cos(angle) * radius, height, center[2] + Math.sin(angle) * radius], options: { style: 'auto', cornerRadius: -1 } };
	network.nodes.set(id, node);
	return node;
}
