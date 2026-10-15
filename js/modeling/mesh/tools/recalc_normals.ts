import { buildEdgeFaces, faceLoop, Vec3 } from './mesh_topology';

/** Directed edge keys of a face loop, in winding order */
function directedEdges(loop: string[]): string[] {
	return loop.map((key: string, i: number) => key + '>' + loop[(i + 1) % loop.length]);
}

function signedVolume(mesh: Mesh, face_keys: string[]): number {
	let volume: number = 0;
	for (const key of face_keys) {
		const loop: string[] = faceLoop(mesh.faces[key]);
		const a: Vec3 = mesh.vertices[loop[0]] as Vec3;
		for (let i: number = 1; i < loop.length - 1; i++) {
			const b: Vec3 = mesh.vertices[loop[i]] as Vec3, c: Vec3 = mesh.vertices[loop[i + 1]] as Vec3;
			volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
		}
	}
	return volume;
}

export interface RecalcResult {
	flipped: number
	components: number
}

/**
 * Makes face windings consistent across connected faces and orients closed shells
 * so the normals point outwards (or inwards).
 */
export function recalculateNormals(mesh: Mesh, face_keys: string[], inside: boolean): RecalcResult {
	const allowed: Set<string> = new Set(face_keys.filter((key: string) => mesh.faces[key] && mesh.faces[key].vertices.length >= 3));
	const edge_faces: Map<string, string[]> = buildEdgeFaces(mesh);
	const visited: Set<string> = new Set();
	let flipped: number = 0, components: number = 0;

	for (const start of allowed) {
		if (visited.has(start)) continue;
		components++;
		const component: string[] = [];
		const queue: string[] = [start];
		visited.add(start);
		while (queue.length) {
			const key: string = queue.shift() as string;
			component.push(key);
			const loop: string[] = faceLoop(mesh.faces[key]);
			for (let i: number = 0; i < loop.length; i++) {
				const a: string = loop[i], b: string = loop[(i + 1) % loop.length];
				const id: string = a < b ? a + '|' + b : b + '|' + a;
				const shared: string[] = edge_faces.get(id) ?? [];
				// Non-manifold edges do not give a clear answer, skip them
				if (shared.length != 2) continue;
				const other_key: string = shared[0] == key ? shared[1] : shared[0];
				if (!allowed.has(other_key) || visited.has(other_key)) continue;
				visited.add(other_key);
				const other: MeshFace = mesh.faces[other_key];
				const other_edges: string[] = directedEdges(faceLoop(other));
				// Neighbors must traverse the shared edge in the opposite direction
				if (other_edges.includes(a + '>' + b)) {
					other.invert();
					flipped++;
				}
				queue.push(other_key);
			}
		}
		const closed: boolean = component.every((key: string) => {
			const loop: string[] = faceLoop(mesh.faces[key]);
			return loop.every((a: string, i: number) => {
				const b: string = loop[(i + 1) % loop.length];
				return (edge_faces.get(a < b ? a + '|' + b : b + '|' + a) ?? []).length == 2;
			});
		});
		if (closed) {
			const volume: number = signedVolume(mesh, component);
			if ((volume < 0) != inside) {
				for (const key of component) mesh.faces[key].invert();
				flipped += component.length;
			}
		}
	}
	return {flipped, components};
}
