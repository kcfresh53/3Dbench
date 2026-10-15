import { MeshGraph } from './mesh_graph';
import { ChartUnwrapper, UnwrappedChart } from './unwrapper';
import { AtlasPacker, PackItem, PackResult, PackPlacement, rotateUV } from './packer';
import { UnwrapOptions, Vec2 } from './types';

export interface UnwrapReport {
	island_count: number
	face_count: number
	/** Worst chart stretch after unwrapping, 1 = isometric */
	max_stretch: number
	/** False when islands had to be shrunk below the requested texel density */
	density_kept: boolean
}

/** Faces that are affected: the selection when there is one, otherwise the whole mesh. */
export function getTargetFaces(mesh: Mesh, selection_only: boolean): string[] {
	if (selection_only) {
		const selected: string[] = mesh.getSelectedFaces();
		if (selected.length) return selected;
	}
	return Object.keys(mesh.faces);
}

function writeFaceUV(mesh: Mesh, face_key: string, vertex_key: string, u: number, v: number): void {
	mesh.faces[face_key].uv[vertex_key] = [u, v];
}

interface MeshCharts {
	mesh: Mesh
	graph: MeshGraph
	charts: UnwrappedChart[]
}

/**
 * Unwraps the target faces of all given meshes and packs the resulting islands into the texture together.
 */
export function unwrapMeshes(meshes: Mesh[], options: UnwrapOptions, selection_only: boolean): UnwrapReport {
	const results: MeshCharts[] = [];
	for (const mesh of meshes) {
		const graph: MeshGraph = MeshGraph.fromMesh(mesh, getTargetFaces(mesh, selection_only));
		if (!graph.faces.length) continue;
		results.push({ mesh, graph, charts: new ChartUnwrapper(graph, options).unwrap() });
	}

	const flat: {entry: MeshCharts, chart: UnwrappedChart}[] = [];
	for (const entry of results) {
		for (const chart of entry.charts) flat.push({ entry, chart });
	}
	const items: PackItem[] = flat.map(({ chart }) => ({ tris: chart.tris }));
	const packer: AtlasPacker = new AtlasPacker(items, {
		width: options.uv_width,
		height: options.uv_height,
		margin: options.margin,
		allow_rotation: options.allow_rotation,
		fixed_scale: options.texel_density,
	});
	const packed: PackResult = packer.pack();

	let face_count: number = 0;
	let max_stretch: number = 1;
	flat.forEach(({ entry, chart }, i: number) => {
		const placement: PackPlacement = packed.placements[i];
		max_stretch = Math.max(max_stretch, chart.stretch);
		chart.faces.forEach((face_index: number, local: number) => {
			const face = entry.graph.faces[face_index];
			face_count++;
			chart.corner_uv[local].forEach(([u, v]: Vec2, corner: number) => {
				const [ru, rv]: Vec2 = rotateUV(u, v, placement.rotated);
				writeFaceUV(
					entry.mesh,
					face.key,
					entry.graph.vertex_keys[face.vertices[corner]],
					ru * packed.scale + placement.tx,
					rv * packed.scale + placement.ty
				);
			});
		});
	});
	return {
		island_count: flat.length,
		face_count,
		max_stretch,
		density_kept: packed.fit_requested,
	};
}

export interface PackIslandsOptions {
	margin: number
	allow_rotation: boolean
	/** Keep the current island scale (shrinks only if it does not fit) instead of maximizing it */
	keep_scale: boolean
	uv_width: number
	uv_height: number
}

export interface UVIsland {
	mesh: Mesh
	face_keys: string[]
	tris: Float64Array
}

function sameUV(a: Vec2, b: Vec2, epsilon: number): boolean {
	return Math.abs(a[0] - b[0]) <= epsilon && Math.abs(a[1] - b[1]) <= epsilon;
}

/** Finds groups of faces that are connected on the UV map, i.e. neighbors whose shared edge has the same UVs. */
export function collectUVIslands(mesh: Mesh, face_keys: string[]): UVIsland[] {
	const graph: MeshGraph = MeshGraph.fromMesh(mesh, face_keys);
	const parent: number[] = graph.faces.map((_, i: number) => i);
	const find = (i: number): number => {
		while (parent[i] != i) {
			parent[i] = parent[parent[i]];
			i = parent[i];
		}
		return i;
	};
	for (const edge of graph.edges) {
		if (edge.faces.length != 2) continue;
		const [fa, fb] = edge.faces;
		const a = mesh.faces[graph.faces[fa].key];
		const b = mesh.faces[graph.faces[fb].key];
		const key0: string = graph.vertex_keys[edge.v0];
		const key1: string = graph.vertex_keys[edge.v1];
		if (!a.uv[key0] || !a.uv[key1] || !b.uv[key0] || !b.uv[key1]) continue;
		if (sameUV(a.uv[key0], b.uv[key0], 0.01) && sameUV(a.uv[key1], b.uv[key1], 0.01)) {
			parent[find(fa)] = find(fb);
		}
	}
	const groups: Map<number, number[]> = new Map();
	graph.faces.forEach((_, i: number) => {
		const root: number = find(i);
		if (!groups.has(root)) groups.set(root, []);
		(groups.get(root) as number[]).push(i);
	});
	const islands: UVIsland[] = [];
	for (const members of groups.values()) {
		const tri_values: number[] = [];
		for (const face_index of members) {
			const face = graph.faces[face_index];
			const mesh_face = mesh.faces[face.key];
			const uvs: Vec2[] = face.vertices.map((v: number) => (mesh_face.uv[graph.vertex_keys[v]] ?? [0, 0]) as Vec2);
			for (let k: number = 1; k < uvs.length - 1; k++) {
				tri_values.push(uvs[0][0], uvs[0][1], uvs[k][0], uvs[k][1], uvs[k + 1][0], uvs[k + 1][1]);
			}
		}
		islands.push({
			mesh,
			face_keys: members.map((i: number) => graph.faces[i].key),
			tris: Float64Array.from(tri_values),
		});
	}
	return islands;
}

/** Repacks the existing UV islands without changing their shape. */
export function packExistingIslands(meshes: Mesh[], options: PackIslandsOptions, selection_only: boolean): UnwrapReport {
	const islands: UVIsland[] = [];
	for (const mesh of meshes) {
		islands.push(...collectUVIslands(mesh, getTargetFaces(mesh, selection_only)));
	}
	const packer: AtlasPacker = new AtlasPacker(islands.map((island: UVIsland) => ({ tris: island.tris })), {
		width: options.uv_width,
		height: options.uv_height,
		margin: options.margin,
		allow_rotation: options.allow_rotation,
		fixed_scale: options.keep_scale ? 1 : 0,
	});
	const packed: PackResult = packer.pack();
	let face_count: number = 0;
	islands.forEach((island: UVIsland, i: number) => {
		const placement: PackPlacement = packed.placements[i];
		for (const face_key of island.face_keys) {
			const face = island.mesh.faces[face_key];
			face_count++;
			for (const vkey of face.vertices) {
				const uv: Vec2 | undefined = face.uv[vkey];
				if (!uv) continue;
				const [ru, rv]: Vec2 = rotateUV(uv[0], uv[1], placement.rotated);
				face.uv[vkey] = [ru * packed.scale + placement.tx, rv * packed.scale + placement.ty];
			}
		}
	});
	return { island_count: islands.length, face_count, max_stretch: 1, density_kept: packed.fit_requested };
}
