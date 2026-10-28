import type { NetworkSettings, NodeOptions, RoadNetwork, RoadNode, RoadProfile, RoadSegment, SegmentData } from './model';
import { edgeKey } from './model';
import type { Vec3 } from './types';
import { DEFAULT_NODE, defaultSegment, mergeSettings } from './defaults';
import { builtinProfile } from './profile_library';
import { RoadCurve } from './curve';
import { distance, length, normalize, scale, sub } from './vec';

const HANDLE_RATIO: number = 1 / 3;

export function createNetwork(settings?: Partial<NetworkSettings>): RoadNetwork {
	return { nodes: new Map(), segments: new Map(), settings: mergeSettings(settings), profiles: new Map() };
}

export function cloneNetwork(network: RoadNetwork): RoadNetwork {
	const nodes: Map<string, RoadNode> = new Map();
	for (const [id, n] of network.nodes) nodes.set(id, { id, position: [n.position[0], n.position[1], n.position[2]], options: { ...n.options } });
	const segments: Map<string, RoadSegment> = new Map();
	for (const [key, s] of network.segments) {
		segments.set(key, { ...s, handleA: s.handleA ? [...s.handleA] : null, handleB: s.handleB ? [...s.handleB] : null });
	}
	return {
		nodes,
		segments,
		settings: JSON.parse(JSON.stringify(network.settings)) as NetworkSettings,
		profiles: new Map(network.profiles),
	};
}

export function addNode(network: RoadNetwork, id: string, position: Vec3, options: Partial<NodeOptions> = {}): RoadNode {
	const node: RoadNode = { id, position: [position[0], position[1], position[2]], options: { ...DEFAULT_NODE, ...options } };
	network.nodes.set(id, node);
	return node;
}

/** Adds a segment between two existing nodes. Returns the existing one if the pair is already linked. */
export function addSegment(network: RoadNetwork, a: string, b: string, data?: Partial<SegmentData>): RoadSegment {
	if (a === b) throw new Error('A road segment needs two different nodes.');
	if (!network.nodes.has(a) || !network.nodes.has(b)) throw new Error('Segment endpoints must exist.');
	const key: string = edgeKey(a, b);
	const existing: RoadSegment | undefined = network.segments.get(key);
	if (existing) return existing;
	const [first, second]: [string, string] = a < b ? [a, b] : [b, a];
	const flipped: boolean = first !== a;
	const base: SegmentData = { ...defaultSegment(network.settings.defaultProfile), ...data };
	const segment: RoadSegment = {
		...base,
		handleA: flipped ? base.handleB : base.handleA,
		handleB: flipped ? base.handleA : base.handleB,
		key,
		a: first,
		b: second,
	};
	network.segments.set(key, segment);
	return segment;
}

export function removeSegment(network: RoadNetwork, key: string): void {
	network.segments.delete(key);
}

/** Removes a node together with every segment that touches it. */
export function removeNode(network: RoadNetwork, id: string): void {
	for (const [key, s] of [...network.segments]) if (s.a === id || s.b === id) network.segments.delete(key);
	network.nodes.delete(id);
}

export function resolveProfileData(network: RoadNetwork, id: string): RoadProfile {
	const profile: RoadProfile | undefined = network.profiles.get(id) ?? builtinProfile(id) ?? builtinProfile(network.settings.defaultProfile) ?? builtinProfile('street');
	if (!profile) throw new Error('No road profile available.');
	return profile;
}

/** Adjacency, built once per generation pass. */
export interface NetworkIndex {
	incident: Map<string, RoadSegment[]>;
}

export function buildIndex(network: RoadNetwork): NetworkIndex {
	const incident: Map<string, RoadSegment[]> = new Map();
	for (const id of network.nodes.keys()) incident.set(id, []);
	for (const s of network.segments.values()) {
		incident.get(s.a)?.push(s);
		incident.get(s.b)?.push(s);
	}
	return { incident };
}

export type NodeKind = 'isolated' | 'end' | 'through' | 'junction';

export function otherEnd(segment: RoadSegment, nodeId: string): string {
	return segment.a === nodeId ? segment.b : segment.a;
}

/**
 * Classifies a node. Two smooth segments with the same road type simply continue through it;
 * everything else (three or more roads, a change of road type, a forced corner) is a junction.
 */
export function classifyNode(network: RoadNetwork, index: NetworkIndex, nodeId: string): NodeKind {
	const node: RoadNode | undefined = network.nodes.get(nodeId);
	const list: RoadSegment[] = index.incident.get(nodeId) ?? [];
	if (!node || list.length === 0) return 'isolated';
	if (list.length === 1) return 'end';
	if (list.length >= 3 || node.options.style === 'junction') return 'junction';
	const [s, t]: RoadSegment[] = list;
	if (node.options.style === 'through') return 'through';
	return s.smooth && t.smooth && s.profile === t.profile ? 'through' : 'junction';
}

/** True when the tangents of two segments at this node are blended into one smooth line. */
export function isSmoothThrough(network: RoadNetwork, index: NetworkIndex, nodeId: string): boolean {
	const list: RoadSegment[] = index.incident.get(nodeId) ?? [];
	if (list.length !== 2) return false;
	const node: RoadNode = network.nodes.get(nodeId) as RoadNode;
	if (node.options.style === 'junction') return false;
	return list[0].smooth && list[1].smooth;
}

/** Handle vector (relative to the node) leaving `nodeId` along `segment`. */
export function handleAt(network: RoadNetwork, index: NetworkIndex, segment: RoadSegment, nodeId: string): Vec3 {
	const explicit: Vec3 | null = nodeId === segment.a ? segment.handleA : segment.handleB;
	if (explicit) return explicit;
	const node: RoadNode = network.nodes.get(nodeId) as RoadNode;
	const other: RoadNode = network.nodes.get(otherEnd(segment, nodeId)) as RoadNode;
	const chord: number = distance(node.position, other.position);
	const reach: number = chord * HANDLE_RATIO;
	if (segment.smooth && isSmoothThrough(network, index, nodeId)) {
		const list: RoadSegment[] = index.incident.get(nodeId) as RoadSegment[];
		const sibling: RoadSegment = list[0] === segment ? list[1] : list[0];
		const far: RoadNode = network.nodes.get(otherEnd(sibling, nodeId)) as RoadNode;
		const toOther: Vec3 = normalize(sub(other.position, node.position));
		const toFar: Vec3 = normalize(sub(far.position, node.position));
		// Direction of travel through the node, from this segment's neighbour towards the sibling's.
		const through: Vec3 = normalize(sub(toFar, toOther));
		if (length(through) > 1e-6) {
			// Heading away from the node along this segment is the opposite of the through direction.
			const away: Vec3 = scale(through, -1);
			const sign: number = away[0] * toOther[0] + away[1] * toOther[1] + away[2] * toOther[2] >= 0 ? 1 : -1;
			return scale(away, reach * sign);
		}
	}
	return scale(normalize(sub(other.position, node.position)), reach);
}

export function segmentCurve(network: RoadNetwork, index: NetworkIndex, segment: RoadSegment): RoadCurve {
	const a: RoadNode = network.nodes.get(segment.a) as RoadNode;
	const b: RoadNode = network.nodes.get(segment.b) as RoadNode;
	const ha: Vec3 = handleAt(network, index, segment, segment.a);
	const hb: Vec3 = handleAt(network, index, segment, segment.b);
	return new RoadCurve(a.position, [a.position[0] + ha[0], a.position[1] + ha[1], a.position[2] + ha[2]], [b.position[0] + hb[0], b.position[1] + hb[1], b.position[2] + hb[2]], b.position);
}

/** Pins the automatically derived handles of a segment so later edits to its neighbours cannot move it. */
export function freezeHandles(network: RoadNetwork, index: NetworkIndex, segment: RoadSegment): void {
	if (!segment.handleA) segment.handleA = handleAt(network, index, segment, segment.a);
	if (!segment.handleB) segment.handleB = handleAt(network, index, segment, segment.b);
}

export function degree(index: NetworkIndex, nodeId: string): number {
	return index.incident.get(nodeId)?.length ?? 0;
}

/** Rebuilds a network with some node ids replaced. Segment keys and handle order follow the new ids. */
export function renameNodes(network: RoadNetwork, map: Map<string, string>): RoadNetwork {
	const result: RoadNetwork = { nodes: new Map(), segments: new Map(), settings: network.settings, profiles: network.profiles };
	const name = (id: string): string => map.get(id) ?? id;
	for (const node of network.nodes.values()) addNode(result, name(node.id), node.position, node.options);
	for (const s of network.segments.values()) {
		addSegment(result, name(s.a), name(s.b), { profile: s.profile, structure: s.structure, smooth: s.smooth, handleA: s.handleA, handleB: s.handleB });
	}
	return result;
}
