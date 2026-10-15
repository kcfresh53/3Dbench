import { buildVertexNeighbors, buildVertexFaces, setMeshSelection } from './mesh_topology';

export type SelectOperation = 'linked' | 'grow' | 'shrink';

/** Vertices of the current selection, expanded from faces / edges if necessary */
function selectedVertexSet(mesh: Mesh): Set<string> {
	const result: Set<string> = new Set(mesh.getSelectedVertices());
	for (const fkey of mesh.getSelectedFaces()) mesh.faces[fkey]?.vertices.forEach((key: string) => result.add(key));
	return result;
}

/**
 * Selection growing / shrinking / flooding, working on vertices and deriving faces and edges from the result.
 * The result is written back as the mesh selection.
 */
export function modifyMeshSelection(mesh: Mesh, operation: SelectOperation): void {
	const neighbors: Map<string, Set<string>> = buildVertexNeighbors(mesh);
	let selection: Set<string> = selectedVertexSet(mesh);
	if (!selection.size) return;

	if (operation == 'linked') {
		const queue: string[] = Array.from(selection);
		while (queue.length) {
			const key: string = queue.pop() as string;
			for (const n of neighbors.get(key) ?? []) {
				if (!selection.has(n)) { selection.add(n); queue.push(n); }
			}
		}
	} else if (operation == 'grow') {
		const grown: Set<string> = new Set(selection);
		for (const key of selection) for (const n of neighbors.get(key) ?? []) grown.add(n);
		selection = grown;
	} else {
		const shrunk: Set<string> = new Set();
		for (const key of selection) {
			const around: Set<string> = neighbors.get(key) ?? new Set();
			if (Array.from(around).every((n: string) => selection.has(n))) shrunk.add(key);
		}
		selection = shrunk;
	}

	const vertex_faces: Map<string, string[]> = buildVertexFaces(mesh);
	const faces: Set<string> = new Set();
	for (const key of selection) {
		for (const fkey of vertex_faces.get(key) ?? []) {
			if (mesh.faces[fkey].vertices.every((v: string) => selection.has(v))) faces.add(fkey);
		}
	}
	const edges: [string, string][] = [];
	const done: Set<string> = new Set();
	for (const key of selection) {
		for (const n of neighbors.get(key) ?? []) {
			const id: string = key < n ? key + '|' + n : n + '|' + key;
			if (selection.has(n) && !done.has(id)) { done.add(id); edges.push([key, n]); }
		}
	}
	setMeshSelection(mesh, selection, faces, edges);
}
