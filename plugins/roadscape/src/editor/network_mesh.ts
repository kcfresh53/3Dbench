import type { Vec3 } from '../core/types';
import type { NetworkSettings, RoadDocument, RoadNetwork, RoadProfile, RoadSegment, SegmentData } from '../core/model';
import { edgeKey } from '../core/model';
import { addNode, addSegment, createNetwork, renameNodes } from '../core/network';
import { BUILTIN_PROFILES } from '../core/profile_library';
import { documentFromNetwork, segmentDefaults } from './document';

/** An edge of the control mesh is a face that has only two vertices. */
function isEdge(face: MeshFace): boolean {
	return face.vertices.length === 2;
}

export function edgesOf(mesh: Mesh): Array<[string, string]> {
	const result: Array<[string, string]> = [];
	for (const face of Object.values(mesh.faces)) if (isEdge(face)) result.push([face.vertices[0], face.vertices[1]]);
	return result;
}

/**
 * Reads the road graph from a control mesh: vertices are junction points, edges are road segments.
 * Edges the document has never seen (made by extruding, for example) copy a neighbouring road.
 */
export function readNetwork(mesh: Mesh, doc: RoadDocument): RoadNetwork {
	const network: RoadNetwork = createNetwork(doc.settings as Partial<NetworkSettings>);
	for (const [id, profile] of Object.entries(doc.profiles)) network.profiles.set(id, profile);
	for (const [key, position] of Object.entries(mesh.vertices)) addNode(network, key, [position[0], position[1], position[2]], doc.nodes[key]);
	const unknown: Array<[string, string]> = [];
	for (const [a, b] of edgesOf(mesh)) {
		if (a === b || !network.nodes.has(a) || !network.nodes.has(b)) continue;
		const stored: SegmentData | undefined = doc.segments[edgeKey(a, b)];
		if (stored) addSegment(network, a < b ? a : b, a < b ? b : a, stored);
		else unknown.push([a, b]);
	}
	// Inherit from any already known road that shares a point, spreading outward one ring at a time.
	let pending: Array<[string, string]> = unknown;
	for (let guard: number = 0; pending.length > 0 && guard < 64; guard++) {
		const next: Array<[string, string]> = [];
		let progressed: boolean = false;
		for (const [a, b] of pending) {
			const neighbour: RoadSegment | null = findNeighbour(network, a, b);
			if (!neighbour && guard < 63 && network.segments.size > 0) {
				next.push([a, b]);
				continue;
			}
			addSegment(network, a < b ? a : b, a < b ? b : a, segmentDefaults(neighbour, network.settings.defaultProfile));
			progressed = true;
		}
		pending = next;
		if (!progressed) break;
	}
	for (const [a, b] of pending) addSegment(network, a < b ? a : b, a < b ? b : a, segmentDefaults(null, network.settings.defaultProfile));
	return network;
}

function findNeighbour(network: RoadNetwork, a: string, b: string): RoadSegment | null {
	for (const s of network.segments.values()) if (s.a === a || s.b === a || s.a === b || s.b === b) return s;
	return null;
}

export interface WriteResult {
	doc: RoadDocument;
	/** Final network with real vertex keys. */
	network: RoadNetwork;
	/** Temporary id to vertex key, for edits that need to find what they created. */
	ids: Map<string, string>;
}

/**
 * Writes a network back into the control mesh. Nodes with temporary ids become new vertices; nodes
 * that disappeared are removed; edges are rebuilt from the segments. Only touches what changed.
 */
export function writeNetwork(mesh: Mesh, network: RoadNetwork): WriteResult {
	const ids: Map<string, string> = new Map();
	const wanted: Set<string> = new Set();
	for (const node of network.nodes.values()) {
		const existing: Vec3 | undefined = mesh.vertices[node.id];
		if (existing) {
			wanted.add(node.id);
			if (existing[0] !== node.position[0] || existing[1] !== node.position[1] || existing[2] !== node.position[2]) {
				mesh.vertices[node.id] = [node.position[0], node.position[1], node.position[2]];
			}
		}
	}
	for (const node of network.nodes.values()) {
		if (wanted.has(node.id)) continue;
		const key: string = mesh.addVertices([node.position[0], node.position[1], node.position[2]])[0];
		ids.set(node.id, key);
		wanted.add(key);
	}
	const finalNetwork: RoadNetwork = ids.size > 0 ? renameNodes(network, ids) : network;
	for (const key of Object.keys(mesh.vertices)) if (!wanted.has(key)) delete mesh.vertices[key];
	for (const [faceKey, face] of Object.entries(mesh.faces)) {
		if (isEdge(face) || face.vertices.some((v: string): boolean => !mesh.vertices[v])) delete mesh.faces[faceKey];
	}
	const edges: MeshFace[] = [];
	for (const s of finalNetwork.segments.values()) edges.push(new MeshFace(mesh, { vertices: [s.a, s.b], texture: false } as never));
	if (edges.length > 0) mesh.addFaces(...edges);
	const selected: string[] = mesh.getSelectedVertices(true);
	for (let i: number = selected.length - 1; i >= 0; i--) if (!mesh.vertices[selected[i]]) selected.splice(i, 1);
	return { doc: documentFromNetwork(finalNetwork), network: finalNetwork, ids };
}

/** Profile definition for an id: project copy first, then the built-in library. */
export function lookupProfile(network: RoadNetwork, id: string): RoadProfile | undefined {
	return network.profiles.get(id) ?? BUILTIN_PROFILES.find((p: RoadProfile): boolean => p.id === id);
}

/** Segments touched by the current vertex selection: edges with both ends selected, else all around a point. */
export function selectedSegments(mesh: Mesh, network: RoadNetwork): RoadSegment[] {
	const picked: Set<string> = new Set(mesh.getSelectedVertices());
	if (picked.size === 0) return [];
	const both: RoadSegment[] = [...network.segments.values()].filter((s: RoadSegment): boolean => picked.has(s.a) && picked.has(s.b));
	if (both.length > 0) return both;
	return [...network.segments.values()].filter((s: RoadSegment): boolean => picked.has(s.a) || picked.has(s.b));
}
