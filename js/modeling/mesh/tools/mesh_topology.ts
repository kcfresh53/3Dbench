export type Vec3 = [number, number, number];

/** Order independent key of an edge */
export function edgeId(a: string, b: string): string {
	return a < b ? a + '|' + b : b + '|' + a;
}

/** The vertex loop of a face, in winding order */
export function faceLoop(face: MeshFace): string[] {
	return face.getSortedVertices().slice();
}

/** Maps every edge to the keys of the faces that use it. */
export function buildEdgeFaces(mesh: Mesh): Map<string, string[]> {
	const map: Map<string, string[]> = new Map();
	for (const key in mesh.faces) {
		const loop: string[] = faceLoop(mesh.faces[key]);
		if (loop.length < 2) continue;
		const count: number = loop.length == 2 ? 1 : loop.length;
		for (let i: number = 0; i < count; i++) {
			const id: string = edgeId(loop[i], loop[(i + 1) % loop.length]);
			const list: string[] | undefined = map.get(id);
			if (list) list.push(key); else map.set(id, [key]);
		}
	}
	return map;
}

/** Maps every vertex to the keys of the faces that contain it. */
export function buildVertexFaces(mesh: Mesh): Map<string, string[]> {
	const map: Map<string, string[]> = new Map();
	for (const key in mesh.faces) {
		for (const vkey of mesh.faces[key].vertices) {
			const list: string[] | undefined = map.get(vkey);
			if (list) list.push(key); else map.set(vkey, [key]);
		}
	}
	return map;
}

/** Vertices connected to each vertex by an edge */
export function buildVertexNeighbors(mesh: Mesh): Map<string, Set<string>> {
	const map: Map<string, Set<string>> = new Map();
	const link = (a: string, b: string): void => {
		if (!map.has(a)) map.set(a, new Set());
		if (!map.has(b)) map.set(b, new Set());
		(map.get(a) as Set<string>).add(b);
		(map.get(b) as Set<string>).add(a);
	};
	for (const key in mesh.faces) {
		const loop: string[] = faceLoop(mesh.faces[key]);
		if (loop.length < 2) continue;
		const count: number = loop.length == 2 ? 1 : loop.length;
		for (let i: number = 0; i < count; i++) link(loop[i], loop[(i + 1) % loop.length]);
	}
	return map;
}

/** Whether the user has narrowed the mesh down to a part of it. Without a selection, tools act on the whole mesh. */
export function hasSubSelection(mesh: Mesh): boolean {
	return mesh.getSelectedVertices().length > 0 || mesh.getSelectedFaces().length > 0;
}

/** Replaces the selection of a mesh. Edges are derived from the faces whose vertices are all selected. */
export function setMeshSelection(mesh: Mesh, vertices: Iterable<string>, faces: Iterable<string>, edges?: [string, string][]): void {
	Project.mesh_selection[mesh.uuid] = {
		vertices: Array.from(vertices),
		faces: Array.from(faces),
		edges: edges ?? [],
	};
}

/**
 * Vertex weights live on the bones, so tools that create vertices have to copy weights over.
 * `sources` lists, for each new vertex, the vertices it is interpolated from.
 */
export function transferWeightsToNewVertices(mesh: Mesh, sources: Map<string, string[]>): void {
	const armature: Armature | undefined = mesh.getArmature?.();
	if (!armature) return;
	for (const bone of armature.getAllBones()) {
		sources.forEach((from: string[], new_key: string) => {
			let total: number = 0;
			for (const key of from) total += bone.getVertexWeight(mesh, key);
			if (total > 0) bone.setVertexWeight(mesh, new_key, total / from.length);
		});
	}
}

/** Elements that have to be recorded in an undo step so that changed vertex weights are restored as well. */
export function undoElementsWithBones(meshes: Mesh[]): OutlinerElement[] {
	const result: OutlinerElement[] = meshes.slice();
	for (const mesh of meshes) {
		const armature: Armature | undefined = mesh.getArmature?.();
		if (armature) for (const bone of armature.getAllBones()) result.safePush(bone);
	}
	return result;
}
