import { GraphEdge, Vec3 } from './types';

export interface GraphFace {
	key: string
	/** Indices into MeshGraph.positions, ordered around the polygon */
	vertices: number[]
	/** Edge ids, edge_ids[i] connects vertices[i] and vertices[i+1] */
	edge_ids: number[]
	normal: Vec3
	area: number
	centroid: Vec3
}

function newellNormal(points: Vec3[]): Vec3 {
	let nx: number = 0;
	let ny: number = 0;
	let nz: number = 0;
	for (let i: number = 0; i < points.length; i++) {
		const a: Vec3 = points[i];
		const b: Vec3 = points[(i + 1) % points.length];
		nx += (a[1] - b[1]) * (a[2] + b[2]);
		ny += (a[2] - b[2]) * (a[0] + b[0]);
		nz += (a[0] - b[0]) * (a[1] + b[1]);
	}
	return [nx, ny, nz];
}

/**
 * Half-edge-free adjacency representation of the selected part of a mesh, used by all unwrap components.
 */
export class MeshGraph {
	readonly positions: Vec3[] = [];
	readonly vertex_keys: string[] = [];
	readonly faces: GraphFace[] = [];
	readonly edges: GraphEdge[] = [];

	static fromMesh(mesh: Mesh, face_keys: string[]): MeshGraph {
		const graph: MeshGraph = new MeshGraph();
		const vertex_index: Map<string, number> = new Map();
		const edge_index: Map<string, number> = new Map();

		for (const face_key of face_keys) {
			const mesh_face: MeshFace = mesh.faces[face_key];
			if (!mesh_face) continue;
			const sorted: string[] = mesh_face.getSortedVertices();
			if (sorted.length < 3) continue;

			const vertices: number[] = [];
			const points: Vec3[] = [];
			for (const vkey of sorted) {
				let index: number | undefined = vertex_index.get(vkey);
				if (index === undefined) {
					index = graph.positions.length;
					vertex_index.set(vkey, index);
					graph.positions.push(mesh.vertices[vkey].slice() as Vec3);
					graph.vertex_keys.push(vkey);
				}
				vertices.push(index);
				points.push(graph.positions[index]);
			}
			const n: Vec3 = newellNormal(points);
			const length: number = Math.hypot(n[0], n[1], n[2]);
			const centroid: Vec3 = [0, 0, 0];
			for (const p of points) {
				centroid[0] += p[0] / points.length;
				centroid[1] += p[1] / points.length;
				centroid[2] += p[2] / points.length;
			}
			const face_index: number = graph.faces.length;
			const edge_ids: number[] = [];
			for (let i: number = 0; i < vertices.length; i++) {
				const a: number = vertices[i];
				const b: number = vertices[(i + 1) % vertices.length];
				const edge_key: string = a < b ? a + '_' + b : b + '_' + a;
				let edge_id: number | undefined = edge_index.get(edge_key);
				if (edge_id === undefined) {
					edge_id = graph.edges.length;
					edge_index.set(edge_key, edge_id);
					const seam_value: MeshSeamValue | undefined = mesh.getSeam([graph.vertex_keys[a], graph.vertex_keys[b]]);
					graph.edges.push({
						id: edge_id,
						v0: Math.min(a, b),
						v1: Math.max(a, b),
						faces: [],
						angle: 0,
						seam: seam_value ?? 'auto',
					});
				}
				graph.edges[edge_id].faces.push(face_index);
				edge_ids.push(edge_id);
			}
			graph.faces.push({
				key: face_key,
				vertices,
				edge_ids,
				normal: length > 1e-12 ? [n[0] / length, n[1] / length, n[2] / length] : [0, 1, 0],
				area: length / 2,
				centroid,
			});
		}

		for (const edge of graph.edges) {
			if (edge.faces.length != 2) continue;
			const a: Vec3 = graph.faces[edge.faces[0]].normal;
			const b: Vec3 = graph.faces[edge.faces[1]].normal;
			const dot: number = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
			edge.angle = Math.acos(dot) * 180 / Math.PI;
		}
		return graph;
	}

	/** The face on the other side of an edge, or -1 when the edge is a border or non-manifold edge */
	otherFace(edge: GraphEdge, face: number): number {
		if (edge.faces.length != 2) return -1;
		return edge.faces[0] == face ? edge.faces[1] : edge.faces[0];
	}

	totalArea(faces: number[]): number {
		let area: number = 0;
		for (const f of faces) area += this.faces[f].area;
		return area;
	}
}
