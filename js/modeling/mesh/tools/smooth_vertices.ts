import { buildEdgeFaces, buildVertexNeighbors, Vec3 } from './mesh_topology';

export interface RelaxOptions {
	iterations: number
	/** Fraction of the way each vertex moves towards the average of its neighbors, per iteration */
	factor: number
	/** Counteract shrinking by alternating a slightly negative pass (Taubin smoothing) */
	keep_volume: boolean
	/** Do not move vertices on open borders */
	pin_borders: boolean
}

/** Laplacian / Taubin smoothing of the given vertices. Positions are changed in place. */
export function relaxVertices(mesh: Mesh, vertex_keys: string[], options: RelaxOptions): void {
	const neighbors: Map<string, Set<string>> = buildVertexNeighbors(mesh);
	const pinned: Set<string> = new Set();
	if (options.pin_borders) {
		for (const [id, faces] of buildEdgeFaces(mesh)) {
			if (faces.length == 1) id.split('|').forEach((key: string) => pinned.add(key));
		}
	}
	const movable: string[] = vertex_keys.filter((key: string) => mesh.vertices[key] && neighbors.has(key) && !pinned.has(key));
	const mu: number = -(options.factor + 0.03);
	for (let iteration: number = 0; iteration < options.iterations; iteration++) {
		const passes: number[] = options.keep_volume ? [options.factor, mu] : [options.factor];
		for (const amount of passes) {
			const next: Map<string, Vec3> = new Map();
			for (const key of movable) {
				const p: Vec3 = mesh.vertices[key] as Vec3;
				const around: Set<string> = neighbors.get(key) as Set<string>;
				const sum: Vec3 = [0, 0, 0];
				for (const n of around) {
					const q: Vec3 = mesh.vertices[n] as Vec3;
					sum[0] += q[0]; sum[1] += q[1]; sum[2] += q[2];
				}
				const count: number = around.size;
				next.set(key, [
					p[0] + (sum[0] / count - p[0]) * amount,
					p[1] + (sum[1] / count - p[1]) * amount,
					p[2] + (sum[2] / count - p[2]) * amount,
				]);
			}
			next.forEach((position: Vec3, key: string) => { mesh.vertices[key] = position; });
		}
	}
}
