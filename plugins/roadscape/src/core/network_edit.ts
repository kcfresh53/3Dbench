import type { NodeOptions, RoadNetwork, RoadNode, RoadSegment, SegmentData } from './model';
import type { Vec3 } from './types';
import { buildIndex, cloneNetwork, addNode, addSegment, freezeHandles, isSmoothThrough, removeNode, segmentCurve, otherEnd } from './network';
import type { NetworkIndex } from './network';
import { closestOnCurve } from './curve';
import type { RoadCurve } from './curve';
import { distanceXZ, sub } from './vec';

/** Produces ids for nodes created by an edit. The editor swaps these for real vertex keys afterwards. */
export type IdFactory = () => string;

export function counterIds(prefix: string = '~n'): IdFactory {
	let n: number = 0;
	return (): string => `${prefix}${++n}`;
}

export type Snap =
	| { type: 'free' }
	| { type: 'node'; id: string }
	| { type: 'segment'; key: string; along: number };

export interface SnapResult {
	snap: Snap;
	position: Vec3;
}

/** Finds the node or segment nearest to a point on the XZ plane, preferring nodes. */
export function snapPoint(network: RoadNetwork, point: Vec3, radius: number): SnapResult {
	let bestNode: RoadNode | null = null;
	let bestDistance: number = radius;
	for (const node of network.nodes.values()) {
		const d: number = distanceXZ(node.position, point);
		if (d <= bestDistance) {
			bestDistance = d;
			bestNode = node;
		}
	}
	if (bestNode) return { snap: { type: 'node', id: bestNode.id }, position: bestNode.position };
	const index: NetworkIndex = buildIndex(network);
	let bestSegment: { key: string; along: number; position: Vec3 } | null = null;
	bestDistance = radius;
	for (const segment of network.segments.values()) {
		const curve: RoadCurve = segmentCurve(network, index, segment);
		const hit: { distance: number; along: number; position: Vec3 } = closestOnCurve(curve, point);
		if (hit.distance <= bestDistance && hit.along > radius * 0.25 && hit.along < curve.length - radius * 0.25) {
			bestDistance = hit.distance;
			bestSegment = { key: segment.key, along: hit.along, position: hit.position };
		}
	}
	if (bestSegment) return { snap: { type: 'segment', key: bestSegment.key, along: bestSegment.along }, position: bestSegment.position };
	return { snap: { type: 'free' }, position: point };
}

/**
 * Splits a segment in two at an arc-length distance from its `a` node. Both halves keep the exact
 * original shape: handles are written explicitly, and so are the handles of neighbours that would
 * otherwise re-smooth now that the split node changes their adjacent direction.
 */
export function splitSegmentAt(network: RoadNetwork, key: string, along: number, newId: string): { node: RoadNode; first: RoadSegment; second: RoadSegment } {
	const segment: RoadSegment | undefined = network.segments.get(key);
	if (!segment) throw new Error('Cannot split a missing segment.');
	const index: NetworkIndex = buildIndex(network);
	for (const end of [segment.a, segment.b]) {
		if (!isSmoothThrough(network, index, end)) continue;
		for (const neighbour of index.incident.get(end) ?? []) if (neighbour !== segment) freezeHandles(network, index, neighbour);
	}
	freezeHandles(network, index, segment);
	const curve: RoadCurve = segmentCurve(network, index, segment);
	const t: number = curve.tAtDistance(along);
	const [low, high]: [RoadCurve, RoadCurve] = curve.splitAt(t);
	const a: RoadNode = network.nodes.get(segment.a) as RoadNode;
	const b: RoadNode = network.nodes.get(segment.b) as RoadNode;
	const node: RoadNode = addNode(network, newId, low.p1);
	const data: SegmentData = { profile: segment.profile, structure: segment.structure, smooth: segment.smooth, handleA: null, handleB: null };
	network.segments.delete(key);
	const first: RoadSegment = addSegment(network, a.id, node.id, { ...data, handleA: sub(low.c0, low.p0), handleB: sub(low.c1, low.p1) });
	const second: RoadSegment = addSegment(network, node.id, b.id, { ...data, handleA: sub(high.c0, high.p0), handleB: sub(high.c1, high.p1) });
	return { node, first, second };
}

/** Replaces `remove` with `keep` in every segment, dropping loops and duplicates. */
export function mergeNodes(network: RoadNetwork, keep: string, remove: string): void {
	if (keep === remove) return;
	for (const segment of [...network.segments.values()]) {
		if (segment.a !== remove && segment.b !== remove) continue;
		network.segments.delete(segment.key);
		const a: string = segment.a === remove ? keep : segment.a;
		const b: string = segment.b === remove ? keep : segment.b;
		if (a === b || network.segments.has(a < b ? `${a}|${b}` : `${b}|${a}`)) continue;
		const data: SegmentData = {
			profile: segment.profile,
			structure: segment.structure,
			smooth: segment.smooth,
			handleA: segment.handleA,
			handleB: segment.handleB,
		};
		// Orientation of the stored handles follows the original (a, b) order.
		addSegment(network, segment.a === remove ? keep : segment.a, segment.b === remove ? keep : segment.b, data);
	}
	network.nodes.delete(remove);
}

interface Crossing {
	first: string;
	second: string;
	firstAlong: number;
	secondAlong: number;
	position: Vec3;
}

function intersectXZ(a0: Vec3, a1: Vec3, b0: Vec3, b1: Vec3): { s: number; t: number } | null {
	const dx: number = a1[0] - a0[0];
	const dz: number = a1[2] - a0[2];
	const ex: number = b1[0] - b0[0];
	const ez: number = b1[2] - b0[2];
	const det: number = dx * ez - dz * ex;
	if (Math.abs(det) < 1e-12) return null;
	const wx: number = b0[0] - a0[0];
	const wz: number = b0[2] - a0[2];
	const s: number = (wx * ez - wz * ex) / det;
	const t: number = (wx * dz - wz * dx) / det;
	return s >= 0 && s <= 1 && t >= 0 && t <= 1 ? { s, t } : null;
}

function polylineDistances(points: Vec3[]): number[] {
	const result: number[] = [0];
	for (let i: number = 1; i < points.length; i++) result.push(result[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]));
	return result;
}

function findCrossing(network: RoadNetwork, index: NetworkIndex, only: Set<string> | null): Crossing | null {
	const unit: number = network.settings.unitsPerMeter;
	const step: number = Math.max(0.75 * unit, 0.25);
	const margin: number = 0.6 * unit;
	const clearance: number = network.settings.junction.clearance * unit;
	const segments: RoadSegment[] = [...network.segments.values()];
	const lines: Map<string, { points: Vec3[]; distances: number[]; length: number }> = new Map();
	for (const s of segments) {
		const points: Vec3[] = segmentCurve(network, index, s).polyline(step);
		const distances: number[] = polylineDistances(points);
		lines.set(s.key, { points, distances, length: distances[distances.length - 1] });
	}
	for (let i: number = 0; i < segments.length; i++) {
		for (let j: number = i + 1; j < segments.length; j++) {
			const p: RoadSegment = segments[i];
			const q: RoadSegment = segments[j];
			if (only && !only.has(p.key) && !only.has(q.key)) continue;
			const shared: string | undefined = [p.a, p.b].find((n: string): boolean => n === q.a || n === q.b);
			const lp = lines.get(p.key)!;
			const lq = lines.get(q.key)!;
			for (let u: number = 0; u < lp.points.length - 1; u++) {
				for (let v: number = 0; v < lq.points.length - 1; v++) {
					const hit: { s: number; t: number } | null = intersectXZ(lp.points[u], lp.points[u + 1], lq.points[v], lq.points[v + 1]);
					if (!hit) continue;
					const pa: number = lp.distances[u] + (lp.distances[u + 1] - lp.distances[u]) * hit.s;
					const qa: number = lq.distances[v] + (lq.distances[v + 1] - lq.distances[v]) * hit.t;
					const yp: number = lp.points[u][1] + (lp.points[u + 1][1] - lp.points[u][1]) * hit.s;
					const yq: number = lq.points[v][1] + (lq.points[v + 1][1] - lq.points[v][1]) * hit.t;
					if (Math.abs(yp - yq) > clearance) continue;
					// A crossing that sits on a shared end node is just the connection itself.
					if (shared) {
						const nodeAlongP: number = shared === p.a ? 0 : lp.length;
						const nodeAlongQ: number = shared === q.a ? 0 : lq.length;
						if (Math.abs(pa - nodeAlongP) < margin * 2 && Math.abs(qa - nodeAlongQ) < margin * 2) continue;
					}
					// Skip crossings that fall on an end of either road: those are touches, handled separately.
					if (pa < margin || pa > lp.length - margin || qa < margin || qa > lq.length - margin) continue;
					const position: Vec3 = [
						lp.points[u][0] + (lp.points[u + 1][0] - lp.points[u][0]) * hit.s,
						(yp + yq) / 2,
						lp.points[u][2] + (lp.points[u + 1][2] - lp.points[u][2]) * hit.s,
					];
					return { first: p.key, second: q.key, firstAlong: pa, secondAlong: qa, position };
				}
			}
		}
	}
	return null;
}

/** A road end that lies on another road without being connected to it. */
function findTouch(network: RoadNetwork, index: NetworkIndex, only: Set<string> | null): { node: string; segment: string; along: number } | null {
	const unit: number = network.settings.unitsPerMeter;
	const tolerance: number = 0.9 * unit;
	const clearance: number = network.settings.junction.clearance * unit;
	for (const node of network.nodes.values()) {
		const own: RoadSegment[] = index.incident.get(node.id) ?? [];
		if (own.length === 0 || own.length > 2) continue;
		for (const segment of network.segments.values()) {
			if (segment.a === node.id || segment.b === node.id) continue;
			if (only && !only.has(segment.key) && !own.some((s: RoadSegment): boolean => only.has(s.key))) continue;
			const curve: RoadCurve = segmentCurve(network, index, segment);
			const hit: { distance: number; along: number; position: Vec3 } = closestOnCurve(curve, node.position);
			if (hit.distance > tolerance || Math.abs(hit.position[1] - node.position[1]) > clearance) continue;
			if (hit.along < tolerance || hit.along > curve.length - tolerance) continue;
			// Do not weld a road to its own neighbour just because they run side by side.
			if (own.some((s: RoadSegment): boolean => otherEnd(s, node.id) === segment.a || otherEnd(s, node.id) === segment.b)) continue;
			return { node: node.id, segment: segment.key, along: hit.along };
		}
	}
	return null;
}

/**
 * Inserts junction nodes wherever roads at (nearly) the same height cross or touch. Roads that
 * pass over one another with at least the clearance between them are left alone. When `only`
 * is given, just those segments (and whatever they are split into) are checked against the rest.
 */
export function autoIntersect(network: RoadNetwork, ids: IdFactory, only?: Set<string>): { created: string[] } {
	const created: string[] = [];
	const watch: Set<string> | null = only ? new Set(only) : null;
	for (let guard: number = 0; guard < 400; guard++) {
		const index: NetworkIndex = buildIndex(network);
		const touch: { node: string; segment: string; along: number } | null = findTouch(network, index, watch);
		if (touch) {
			const split: { node: RoadNode; first: RoadSegment; second: RoadSegment } = splitSegmentAt(network, touch.segment, touch.along, ids());
			watch?.delete(touch.segment);
			watch?.add(split.first.key);
			watch?.add(split.second.key);
			mergeNodes(network, touch.node, split.node.id);
			// The merged node moved onto the road end; refresh the watch set with fresh keys.
			for (const s of network.segments.values()) if (s.a === touch.node || s.b === touch.node) watch?.add(s.key);
			continue;
		}
		const crossing: Crossing | null = findCrossing(network, index, watch);
		if (!crossing) break;
		const firstId: string = ids();
		const first: { node: RoadNode; first: RoadSegment; second: RoadSegment } = splitSegmentAt(network, crossing.first, crossing.firstAlong, firstId);
		watch?.delete(crossing.first);
		watch?.add(first.first.key);
		watch?.add(first.second.key);
		// The second road must still exist under its old key (unrelated to the first split).
		const secondKey: string = crossing.second;
		const secondIndex: NetworkIndex = buildIndex(network);
		const secondSegment: RoadSegment | undefined = network.segments.get(secondKey);
		if (!secondSegment) break;
		const along: number = closestOnCurve(segmentCurve(network, secondIndex, secondSegment), crossing.position).along;
		const second: { node: RoadNode; first: RoadSegment; second: RoadSegment } = splitSegmentAt(network, secondKey, along, ids());
		watch?.delete(secondKey);
		watch?.add(second.first.key);
		watch?.add(second.second.key);
		mergeNodes(network, first.node.id, second.node.id);
		const merged: RoadNode = network.nodes.get(first.node.id) as RoadNode;
		merged.position = [crossing.position[0], crossing.position[1], crossing.position[2]];
		created.push(first.node.id);
		for (const s of network.segments.values()) if (s.a === first.node.id || s.b === first.node.id) watch?.add(s.key);
	}
	return { created };
}

export interface DraftAnchor {
	position: Vec3;
	snap: Snap;
}

export interface DraftResult {
	network: RoadNetwork;
	/** Node ids along the drawn path, in order. */
	path: string[];
	segmentKeys: string[];
}

/**
 * Applies a drawn polyline to a copy of the network, the way a city builder does: clicks that land
 * on an existing road split it and connect, clicks on a node reuse it, and any roads the new
 * segments cross become junctions automatically.
 */
export function applyDraft(source: RoadNetwork, anchors: DraftAnchor[], ids: IdFactory, data: Partial<SegmentData>, closed: boolean = false, radius: number = 1): DraftResult {
	const network: RoadNetwork = cloneNetwork(source);
	const path: string[] = [];
	for (const anchor of anchors) {
		let nodeId: string | null = null;
		if (anchor.snap.type === 'node' && network.nodes.has(anchor.snap.id)) {
			nodeId = anchor.snap.id;
		} else if (anchor.snap.type === 'segment') {
			const fresh: SnapResult = snapPoint(network, anchor.position, radius);
			if (fresh.snap.type === 'node') nodeId = fresh.snap.id;
			else if (fresh.snap.type === 'segment') nodeId = splitSegmentAt(network, fresh.snap.key, fresh.snap.along, ids()).node.id;
		}
		if (!nodeId) {
			nodeId = ids();
			addNode(network, nodeId, anchor.position);
		}
		if (path[path.length - 1] !== nodeId) path.push(nodeId);
	}
	const keys: string[] = [];
	const count: number = closed && path.length > 2 ? path.length : path.length - 1;
	for (let i: number = 0; i < count; i++) {
		const a: string = path[i];
		const b: string = path[(i + 1) % path.length];
		if (a === b) continue;
		const existed: boolean = network.segments.has(a < b ? `${a}|${b}` : `${b}|${a}`);
		const segment: RoadSegment = addSegment(network, a, b, data);
		if (!existed) keys.push(segment.key);
	}
	const result: { created: string[] } = autoIntersect(network, ids, new Set(keys));
	void result;
	return { network, path, segmentKeys: keys };
}

/** Moves every node and segment of `other` into `target`, then connects roads that cross. */
export function joinNetworks(target: RoadNetwork, other: RoadNetwork, ids: IdFactory): string[] {
	const map: Map<string, string> = new Map();
	for (const node of other.nodes.values()) {
		const id: string = target.nodes.has(node.id) ? ids() : node.id;
		map.set(node.id, id);
		addNode(target, id, node.position, node.options as NodeOptions);
	}
	for (const [id, profile] of other.profiles) if (!target.profiles.has(id)) target.profiles.set(id, profile);
	const added: Set<string> = new Set();
	for (const s of other.segments.values()) {
		const segment: RoadSegment = addSegment(target, map.get(s.a) as string, map.get(s.b) as string, {
			profile: s.profile,
			structure: s.structure,
			smooth: s.smooth,
			handleA: s.handleA,
			handleB: s.handleB,
		});
		added.add(segment.key);
	}
	autoIntersect(target, ids, added);
	return [...added];
}

/**
 * Removes a point the way a person expects: a point in the middle of a road disappears and its two
 * neighbours join up, keeping the road type and shape intent; a junction or end simply loses its roads.
 */
export function removePoint(network: RoadNetwork, nodeId: string): void {
	const index: NetworkIndex = buildIndex(network);
	const list: RoadSegment[] = index.incident.get(nodeId) ?? [];
	if (list.length === 2) {
		const [s, t]: RoadSegment[] = list;
		const a: string = otherEnd(s, nodeId);
		const b: string = otherEnd(t, nodeId);
		network.nodes.delete(nodeId);
		network.segments.delete(s.key);
		network.segments.delete(t.key);
		if (a !== b) addSegment(network, a, b, { profile: s.profile, structure: s.structure, smooth: s.smooth && t.smooth });
		return;
	}
	removeNode(network, nodeId);
}

/** Adds a point in the middle of a road. */
export function insertPoint(network: RoadNetwork, key: string, id: string): RoadNode {
	const segment: RoadSegment | undefined = network.segments.get(key);
	if (!segment) throw new Error('That road no longer exists.');
	const curve: RoadCurve = segmentCurve(network, buildIndex(network), segment);
	return splitSegmentAt(network, key, curve.length / 2, id).node;
}
