import { MeshGraph, GraphFace } from './mesh_graph';
import { Vec3 } from './types';

/**
 * A chart is a set of faces. Chart vertices are "corner groups": two corners of the same mesh vertex are the
 * same chart vertex only if they are connected through a fan of faces that is glued over non-cut edges.
 * That way cuts that lie inside a chart (slits) are handled naturally.
 */
export interface ChartMesh {
	/** Graph face indices of this chart */
	faces: number[]
	vertex_count: number
	/** corner_vertex[local face][corner] = chart vertex */
	corner_vertex: number[][]
	/** 3D position per chart vertex */
	positions: Vec3[]
	/** Triangle corner triples (chart vertex ids) */
	triangles: number[]
	/** Local face index for each triangle */
	triangle_face: number[]
	/** Boundary half-edges in chart vertex ids */
	boundary: [number, number][]
	glued_edge_count: number
	unglued_edge_count: number
}

function distance(a: Vec3, b: Vec3): number {
	return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function buildChartMesh(graph: MeshGraph, faces: number[], cut: Uint8Array): ChartMesh {
	const local_of: Map<number, number> = new Map();
	faces.forEach((f: number, i: number) => local_of.set(f, i));
	const offsets: number[] = [];
	let corner_total: number = 0;
	for (const f of faces) {
		offsets.push(corner_total);
		corner_total += graph.faces[f].vertices.length;
	}
	const parent: Int32Array = new Int32Array(corner_total);
	for (let i: number = 0; i < corner_total; i++) parent[i] = i;
	const find = (i: number): number => {
		while (parent[i] != i) {
			parent[i] = parent[parent[i]];
			i = parent[i];
		}
		return i;
	};
	const union = (a: number, b: number): void => {
		const ra: number = find(a);
		const rb: number = find(b);
		if (ra != rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
	};

	let glued: number = 0;
	let unglued: number = 0;
	const unglued_half_edges: [number, number][] = [];

	faces.forEach((face_index: number, local: number) => {
		const face: GraphFace = graph.faces[face_index];
		const n: number = face.vertices.length;
		for (let k: number = 0; k < n; k++) {
			const edge = graph.edges[face.edge_ids[k]];
			const other: number = graph.otherFace(edge, face_index);
			const other_local: number | undefined = other >= 0 && !cut[edge.id] ? local_of.get(other) : undefined;
			if (other_local === undefined) {
				unglued++;
				unglued_half_edges.push([local, k]);
				continue;
			}
			if (face_index < other) glued++;
			const other_face: GraphFace = graph.faces[other];
			const a: number = face.vertices[k];
			const b: number = face.vertices[(k + 1) % n];
			union(offsets[local] + k, offsets[other_local] + other_face.vertices.indexOf(a));
			union(offsets[local] + (k + 1) % n, offsets[other_local] + other_face.vertices.indexOf(b));
		}
	});

	const root_id: Map<number, number> = new Map();
	const positions: Vec3[] = [];
	const corner_vertex: number[][] = [];
	faces.forEach((face_index: number, local: number) => {
		const face: GraphFace = graph.faces[face_index];
		const ids: number[] = [];
		for (let k: number = 0; k < face.vertices.length; k++) {
			const root: number = find(offsets[local] + k);
			let id: number | undefined = root_id.get(root);
			if (id === undefined) {
				id = positions.length;
				root_id.set(root, id);
				positions.push(graph.positions[face.vertices[k]]);
			}
			ids.push(id);
		}
		corner_vertex.push(ids);
	});

	const triangles: number[] = [];
	const triangle_face: number[] = [];
	corner_vertex.forEach((ids: number[], local: number) => {
		const n: number = ids.length;
		const pushTriangle = (a: number, b: number, c: number): void => {
			triangles.push(ids[a], ids[b], ids[c]);
			triangle_face.push(local);
		};
		if (n == 3) {
			pushTriangle(0, 1, 2);
		} else if (n == 4) {
			const p: Vec3[] = ids.map((id: number) => positions[id]);
			if (distance(p[0], p[2]) <= distance(p[1], p[3])) {
				pushTriangle(0, 1, 2);
				pushTriangle(0, 2, 3);
			} else {
				pushTriangle(1, 2, 3);
				pushTriangle(1, 3, 0);
			}
		} else {
			for (let k: number = 1; k < n - 1; k++) pushTriangle(0, k, k + 1);
		}
	});

	const boundary: [number, number][] = unglued_half_edges.map(([local, k]: [number, number]) => {
		const ids: number[] = corner_vertex[local];
		return [ids[k], ids[(k + 1) % ids.length]] as [number, number];
	});

	return {
		faces,
		vertex_count: positions.length,
		corner_vertex,
		positions,
		triangles,
		triangle_face,
		boundary,
		glued_edge_count: glued,
		unglued_edge_count: unglued,
	};
}

export interface ChartTopology {
	euler: number
	boundary_loops: number
	is_disk: boolean
}

export function analyzeTopology(chart: ChartMesh): ChartTopology {
	const euler: number = chart.vertex_count - (chart.glued_edge_count + chart.unglued_edge_count) + chart.faces.length;
	const parent: Map<number, number> = new Map();
	const find = (i: number): number => {
		let root: number = i;
		while (parent.get(root) != root) root = parent.get(root) as number;
		return root;
	};
	for (const [a, b] of chart.boundary) {
		if (!parent.has(a)) parent.set(a, a);
		if (!parent.has(b)) parent.set(b, b);
		const ra: number = find(a);
		const rb: number = find(b);
		if (ra != rb) parent.set(ra, rb);
	}
	const roots: Set<number> = new Set();
	for (const v of parent.keys()) roots.add(find(v));
	return {
		euler,
		boundary_loops: roots.size,
		is_disk: euler == 1 && roots.size == 1,
	};
}
