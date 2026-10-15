import { MeshGraph, GraphFace } from './mesh_graph';
import { GraphEdge } from './types';

/** Binary min-heap keyed by number, holding face indices */
class FaceHeap {
	private items: number[] = [];
	private keys: number[] = [];
	get size(): number {
		return this.items.length;
	}
	push(item: number, key: number): void {
		let i: number = this.items.length;
		this.items.push(item);
		this.keys.push(key);
		while (i > 0) {
			const parent: number = (i - 1) >> 1;
			if (this.keys[parent] <= this.keys[i]) break;
			this.swap(i, parent);
			i = parent;
		}
	}
	pop(): [number, number] {
		const item: number = this.items[0];
		const key: number = this.keys[0];
		const last_item: number = this.items.pop() as number;
		const last_key: number = this.keys.pop() as number;
		if (this.items.length) {
			this.items[0] = last_item;
			this.keys[0] = last_key;
			let i: number = 0;
			for (;;) {
				const l: number = 2 * i + 1;
				const r: number = l + 1;
				let m: number = i;
				if (l < this.items.length && this.keys[l] < this.keys[m]) m = l;
				if (r < this.items.length && this.keys[r] < this.keys[m]) m = r;
				if (m == i) break;
				this.swap(i, m);
				i = m;
			}
		}
		return [item, key];
	}
	private swap(a: number, b: number): void {
		[this.items[a], this.items[b]] = [this.items[b], this.items[a]];
		[this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
	}
}

interface DualSearch {
	dist: Float64Array
	label: Int32Array
	pred_edge: Int32Array
}

/** Cost of walking from a face to its neighbor. Creases are expensive, so cut lines gravitate towards them. */
function dualCost(graph: MeshGraph, edge: GraphEdge, a: GraphFace, b: GraphFace): number {
	const distance: number = Math.hypot(
		a.centroid[0] - b.centroid[0],
		a.centroid[1] - b.centroid[1],
		a.centroid[2] - b.centroid[2]
	);
	return (distance + 1e-6) * (1 + edge.angle / 15);
}

function dualSearch(graph: MeshGraph, in_set: Set<number>, cut: Uint8Array, sources: number[]): DualSearch {
	const dist: Float64Array = new Float64Array(graph.faces.length).fill(Infinity);
	const label: Int32Array = new Int32Array(graph.faces.length).fill(-1);
	const pred_edge: Int32Array = new Int32Array(graph.faces.length).fill(-1);
	const heap: FaceHeap = new FaceHeap();
	sources.forEach((source: number, i: number) => {
		dist[source] = 0;
		label[source] = i;
		heap.push(source, 0);
	});
	while (heap.size) {
		const [face_index, d]: [number, number] = heap.pop();
		if (d > dist[face_index]) continue;
		const face: GraphFace = graph.faces[face_index];
		for (const edge_id of face.edge_ids) {
			const edge: GraphEdge = graph.edges[edge_id];
			if (cut[edge_id]) continue;
			const other: number = graph.otherFace(edge, face_index);
			if (other < 0 || !in_set.has(other)) continue;
			const nd: number = d + dualCost(graph, edge, face, graph.faces[other]);
			if (nd < dist[other]) {
				dist[other] = nd;
				label[other] = label[face_index];
				pred_edge[other] = edge_id;
				heap.push(other, nd);
			}
		}
	}
	return { dist, label, pred_edge };
}

/** Connected components of a face set over non-cut edges */
export function componentsOf(graph: MeshGraph, faces: number[], cut: Uint8Array): number[][] {
	const in_set: Set<number> = new Set(faces);
	const visited: Set<number> = new Set();
	const result: number[][] = [];
	for (const start of faces) {
		if (visited.has(start)) continue;
		const component: number[] = [];
		const stack: number[] = [start];
		visited.add(start);
		while (stack.length) {
			const f: number = stack.pop() as number;
			component.push(f);
			for (const edge_id of graph.faces[f].edge_ids) {
				if (cut[edge_id]) continue;
				const other: number = graph.otherFace(graph.edges[edge_id], f);
				if (other < 0 || !in_set.has(other) || visited.has(other)) continue;
				visited.add(other);
				stack.push(other);
			}
		}
		result.push(component);
	}
	return result;
}

function farthestFace(dist: Float64Array, faces: number[]): number {
	let best: number = faces[0];
	for (const f of faces) {
		if (isFinite(dist[f]) && dist[f] > dist[best]) best = f;
	}
	return best;
}

/**
 * Splits a chart in two along a line that follows creases. Used for closed surfaces and for charts that
 * have too much distortion. Returns the edge ids to cut, empty if the chart cannot be split.
 */
export function computeBisectionCuts(graph: MeshGraph, faces: number[], cut: Uint8Array): number[] {
	if (faces.length < 2) return [];
	const in_set: Set<number> = new Set(faces);
	const first: DualSearch = dualSearch(graph, in_set, cut, [faces[0]]);
	const seed_a: number = farthestFace(first.dist, faces);
	const second: DualSearch = dualSearch(graph, in_set, cut, [seed_a]);
	const seed_b: number = farthestFace(second.dist, faces);
	if (seed_a == seed_b) return [];
	const split: DualSearch = dualSearch(graph, in_set, cut, [seed_a, seed_b]);

	const result: number[] = [];
	const seen: Set<number> = new Set();
	for (const f of faces) {
		for (const edge_id of graph.faces[f].edge_ids) {
			if (cut[edge_id] || seen.has(edge_id)) continue;
			seen.add(edge_id);
			const other: number = graph.otherFace(graph.edges[edge_id], f);
			if (other < 0 || !in_set.has(other)) continue;
			if (split.label[f] != split.label[other]) result.push(edge_id);
		}
	}
	return result;
}

/**
 * Tree-cotree cut graph for charts that have boundary but are not disks (handles, holes, tubes).
 * A shortest path tree over the dual graph is grown from the highest face, the remaining edges are cut and
 * dangling cut paths are pruned. Seams therefore end up on the side opposite of the top of the model.
 * Returns the edge ids to cut, empty if no cut could be found.
 */
export function computeDiskCuts(graph: MeshGraph, faces: number[], cut: Uint8Array): number[] {
	const in_set: Set<number> = new Set(faces);
	let seed: number = faces[0];
	for (const f of faces) {
		if (graph.faces[f].centroid[1] > graph.faces[seed].centroid[1]) seed = f;
	}
	const search: DualSearch = dualSearch(graph, in_set, cut, [seed]);
	const tree_edges: Set<number> = new Set();
	for (const f of faces) {
		if (search.pred_edge[f] >= 0) tree_edges.add(search.pred_edge[f]);
	}

	const candidates: Set<number> = new Set();
	const degree: Map<number, number> = new Map();
	const incident: Map<number, number[]> = new Map();
	const addDegree = (v: number): void => {
		degree.set(v, (degree.get(v) ?? 0) + 1);
	};
	const visited_edges: Set<number> = new Set();
	for (const f of faces) {
		for (const edge_id of graph.faces[f].edge_ids) {
			if (visited_edges.has(edge_id)) continue;
			visited_edges.add(edge_id);
			const edge: GraphEdge = graph.edges[edge_id];
			const other: number = graph.otherFace(edge, f);
			const interior: boolean = other >= 0 && in_set.has(other) && !cut[edge_id];
			if (interior && !tree_edges.has(edge_id)) {
				candidates.add(edge_id);
				for (const v of [edge.v0, edge.v1]) {
					if (!incident.has(v)) incident.set(v, []);
					(incident.get(v) as number[]).push(edge_id);
				}
			}
			if (!interior || !tree_edges.has(edge_id)) {
				addDegree(edge.v0);
				addDegree(edge.v1);
			}
		}
	}
	const stack: number[] = [];
	for (const [v, d] of degree) if (d == 1) stack.push(v);
	while (stack.length) {
		const v: number = stack.pop() as number;
		if (degree.get(v) != 1) continue;
		const edge_id: number | undefined = (incident.get(v) ?? []).find((e: number) => candidates.has(e));
		if (edge_id === undefined) continue;
		candidates.delete(edge_id);
		const edge: GraphEdge = graph.edges[edge_id];
		for (const end of [edge.v0, edge.v1]) {
			degree.set(end, (degree.get(end) as number) - 1);
			if (degree.get(end) == 1) stack.push(end);
		}
	}
	return Array.from(candidates);
}
