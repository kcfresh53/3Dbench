import { buildEdgeFaces, buildVertexFaces, edgeId, faceLoop, transferWeightsToNewVertices, Vec3 } from './mesh_topology';

type UV = [number, number];

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function average3(points: Vec3[]): Vec3 {
	const sum: Vec3 = [0, 0, 0];
	for (const p of points) { sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; }
	return [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length];
}
function averageUV(points: UV[]): UV {
	let u: number = 0, v: number = 0;
	for (const p of points) { u += p[0]; v += p[1]; }
	return [u / points.length, v / points.length];
}

export interface SubdivideResult {
	/** Keys of the faces that replaced the target faces */
	new_faces: string[]
	/** Keys of every vertex used by the new faces */
	vertices: string[]
}

/**
 * Splits each target face into one quad per corner (a 1-to-4 split for quads).
 * With `smooth` > 0, new and old points move towards the Catmull-Clark limit surface.
 * Faces next to the target that share a split edge are triangulated so the mesh stays free of T-junctions.
 */
export function subdivideFaces(mesh: Mesh, target_keys: string[], smooth: number): SubdivideResult {
	const target: Set<string> = new Set(target_keys.filter((key: string) => mesh.faces[key] && mesh.faces[key].vertices.length >= 3));
	if (!target.size) return {new_faces: [], vertices: []};

	const edge_faces: Map<string, string[]> = buildEdgeFaces(mesh);
	const vertex_faces: Map<string, string[]> = buildVertexFaces(mesh);
	const pos = (key: string): Vec3 => mesh.vertices[key] as Vec3;

	const loops: Map<string, string[]> = new Map();
	for (const key of target) loops.set(key, faceLoop(mesh.faces[key]));
	const centroids: Map<string, Vec3> = new Map();
	for (const [key, loop] of loops) centroids.set(key, average3(loop.map(pos)));

	/** An edge is interior when both of its faces are being subdivided */
	const isInterior = (id: string): boolean => {
		const faces: string[] = edge_faces.get(id) ?? [];
		return faces.length == 2 && faces.every((key: string) => target.has(key));
	};

	// --- Edge points
	const edge_ids: string[] = [];
	const edge_ends: Map<string, [string, string]> = new Map();
	for (const loop of loops.values()) {
		for (let i: number = 0; i < loop.length; i++) {
			const a: string = loop[i], b: string = loop[(i + 1) % loop.length];
			const id: string = edgeId(a, b);
			if (!edge_ends.has(id)) { edge_ends.set(id, [a, b]); edge_ids.push(id); }
		}
	}
	const edge_positions: Vec3[] = edge_ids.map((id: string) => {
		const [a, b] = edge_ends.get(id) as [string, string];
		const mid: Vec3 = lerp3(pos(a), pos(b), 0.5);
		if (smooth <= 0 || !isInterior(id)) return mid;
		const faces: string[] = edge_faces.get(id) as string[];
		const limit: Vec3 = average3([pos(a), pos(b), centroids.get(faces[0]) as Vec3, centroids.get(faces[1]) as Vec3]);
		return lerp3(mid, limit, smooth);
	});

	// --- Moved positions of the original vertices
	const moved: Map<string, Vec3> = new Map();
	if (smooth > 0) {
		const touched: Set<string> = new Set();
		for (const loop of loops.values()) loop.forEach((key: string) => touched.add(key));
		for (const vkey of touched) {
			const incident: Set<string> = new Set();
			const faces: string[] = vertex_faces.get(vkey) ?? [];
			for (const fkey of faces) {
				const loop: string[] = faceLoop(mesh.faces[fkey]);
				const i: number = loop.indexOf(vkey);
				incident.add(edgeId(vkey, loop[(i + 1) % loop.length]));
				incident.add(edgeId(vkey, loop[(i + loop.length - 1) % loop.length]));
			}
			const other = (id: string): string => (edge_ends.get(id) ?? id.split('|')) .find((k: string) => k !== vkey) as string;
			const interior: boolean = Array.from(incident).every(isInterior);
			let limit: Vec3 | null = null;
			if (interior && incident.size >= 3) {
				const n: number = incident.size;
				const q: Vec3 = average3(faces.map((f: string) => centroids.get(f) as Vec3));
				const r: Vec3 = average3(Array.from(incident).map((id: string) => lerp3(pos(vkey), pos(other(id)), 0.5)));
				const p: Vec3 = pos(vkey);
				limit = [0, 1, 2].map((k: number) => (q[k] + 2 * r[k] + (n - 3) * p[k]) / n) as Vec3;
			} else {
				const border: string[] = Array.from(incident).filter((id: string) => !isInterior(id));
				if (border.length == 2) {
					const a: Vec3 = pos(other(border[0])), b: Vec3 = pos(other(border[1])), p: Vec3 = pos(vkey);
					limit = [0, 1, 2].map((k: number) => (6 * p[k] + a[k] + b[k]) / 8) as Vec3;
				}
			}
			if (limit) moved.set(vkey, lerp3(pos(vkey), limit, smooth));
		}
	}

	// --- Create vertices
	const face_keys: string[] = Array.from(loops.keys());
	const new_keys: string[] = mesh.addVertices(...edge_positions, ...face_keys.map((key: string) => centroids.get(key) as Vec3));
	const edge_vertex: Map<string, string> = new Map();
	edge_ids.forEach((id: string, i: number) => edge_vertex.set(id, new_keys[i]));
	const face_vertex: Map<string, string> = new Map();
	face_keys.forEach((key: string, i: number) => face_vertex.set(key, new_keys[edge_ids.length + i]));

	const weight_sources: Map<string, string[]> = new Map();
	edge_ids.forEach((id: string) => weight_sources.set(edge_vertex.get(id) as string, edge_ends.get(id) as [string, string]));
	for (const key of face_keys) weight_sources.set(face_vertex.get(key) as string, loops.get(key) as string[]);
	transferWeightsToNewVertices(mesh, weight_sources);

	// --- Build new faces
	const new_faces: string[] = [];
	const used_vertices: Set<string> = new Set();
	for (const fkey of face_keys) {
		const face: MeshFace = mesh.faces[fkey];
		const loop: string[] = loops.get(fkey) as string[];
		const center: string = face_vertex.get(fkey) as string;
		const uv = (key: string): UV => (face.uv[key] ?? [0, 0]) as UV;
		const center_uv: UV = averageUV(loop.map(uv));
		const children: MeshFace[] = [];
		for (let i: number = 0; i < loop.length; i++) {
			const v: string = loop[i];
			const next: string = edge_vertex.get(edgeId(v, loop[(i + 1) % loop.length])) as string;
			const prev: string = edge_vertex.get(edgeId(loop[(i + loop.length - 1) % loop.length], v)) as string;
			const v_next: string = loop[(i + 1) % loop.length], v_prev: string = loop[(i + loop.length - 1) % loop.length];
			const child: MeshFace = new MeshFace(mesh, {vertices: [v, next, center, prev]});
			child.uv[v] = uv(v).slice() as UV;
			child.uv[next] = averageUV([uv(v), uv(v_next)]);
			child.uv[center] = center_uv.slice() as UV;
			child.uv[prev] = averageUV([uv(v_prev), uv(v)]);
			child.texture = face.texture;
			children.push(child);
		}
		new_faces.push(...mesh.addFaces(...children));
		children.forEach((child: MeshFace) => child.vertices.forEach((k: string) => used_vertices.add(k)));
	}

	// --- Repair neighbours that share a split edge: insert the new point and triangulate if the face gets too big
	const repaired: Set<string> = new Set();
	for (const id of edge_ids) {
		for (const nkey of edge_faces.get(id) ?? []) {
			if (target.has(nkey) || repaired.has(nkey) || !mesh.faces[nkey]) continue;
			repaired.add(nkey);
			const neighbor: MeshFace = mesh.faces[nkey];
			const loop: string[] = faceLoop(neighbor);
			if (loop.length < 3) continue;
			const full: string[] = [];
			for (let i: number = 0; i < loop.length; i++) {
				full.push(loop[i]);
				const split: string | undefined = edge_vertex.get(edgeId(loop[i], loop[(i + 1) % loop.length]));
				if (split && loop.length > 2) full.push(split);
			}
			const uv = (key: string): UV => (neighbor.uv[key] ?? averageUV(loop.map((k: string) => (neighbor.uv[k] ?? [0, 0]) as UV))) as UV;
			// Midpoint UVs follow from the neighbouring corners
			full.forEach((key: string, i: number) => {
				if (!neighbor.uv[key]) neighbor.uv[key] = averageUV([uv(full[(i + full.length - 1) % full.length]), uv(full[(i + 1) % full.length])]);
			});
			const unsplit = (a: string, b: string): boolean => !edge_vertex.has(edgeId(a, b));
			const fan_start: number = full.findIndex((key: string) => {
				const li: number = loop.indexOf(key);
				return li >= 0 && unsplit(loop[li], loop[(li + 1) % loop.length]) && unsplit(loop[(li + loop.length - 1) % loop.length], loop[li]);
			});
			const makeTri = (a: string, b: string, c: string): MeshFace => {
				const tri: MeshFace = new MeshFace(mesh, {vertices: [a, b, c]});
				[a, b, c].forEach((key: string) => { tri.uv[key] = (neighbor.uv[key] ?? [0, 0]).slice() as UV; });
				tri.texture = neighbor.texture;
				return tri;
			};
			const replacements: MeshFace[] = [];
			if (fan_start >= 0) {
				// Triangle fan from a corner that does not touch a split edge
				const ring: string[] = full.slice(fan_start).concat(full.slice(0, fan_start));
				for (let k: number = 1; k < ring.length - 1; k++) replacements.push(makeTri(ring[0], ring[k], ring[k + 1]));
			} else {
				// Every edge is split: fan around a new center point
				const [center]: string[] = mesh.addVertices(average3(loop.map(pos)));
				neighbor.uv[center] = averageUV(loop.map((k: string) => (neighbor.uv[k] ?? [0, 0]) as UV));
				transferWeightsToNewVertices(mesh, new Map([[center, loop]]));
				for (let k: number = 0; k < full.length; k++) replacements.push(makeTri(center, full[k], full[(k + 1) % full.length]));
			}
			delete mesh.faces[nkey];
			mesh.addFaces(...replacements);
		}
	}

	// --- Apply moved vertices and remove replaced faces
	moved.forEach((position: Vec3, key: string) => { mesh.vertices[key] = position; });
	for (const fkey of face_keys) delete mesh.faces[fkey];

	return {new_faces, vertices: Array.from(used_vertices)};
}
