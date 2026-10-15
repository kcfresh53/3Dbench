import { THREE } from '../../lib/libs';
import { Armature } from '../../outliner/types/armature';
import { ArmatureBone } from '../../outliner/types/armature_bone';
import { solveSymmetricCG } from '../mesh/unwrap/linear_solver';

export interface HeatWeightOptions {
	/** Higher values keep weights closer to the bone, lower values spread them further. Default 1. */
	locality: number
	/** Maximum number of bones that influence a vertex */
	max_influences: number
	/** Weights below this are dropped */
	prune_threshold: number
	/** Ignore bones that are hidden behind other parts of the mesh when picking the closest bone */
	check_visibility: boolean
}

export const DEFAULT_HEAT_OPTIONS: HeatWeightOptions = {
	locality: 1,
	max_influences: 4,
	prune_threshold: 0.02,
	check_visibility: true,
};

interface BoneSegment {
	bone: ArmatureBone
	head: THREE.Vector3
	tail: THREE.Vector3
}

interface SurfaceData {
	vertex_keys: string[]
	positions: THREE.Vector3[]
	normals: THREE.Vector3[]
	triangles: number[]
	/** Voronoi style area per vertex */
	areas: Float64Array
	neighbors: number[][]
	cotangents: number[][]
}

export function getBoneSegment(bone: ArmatureBone): BoneSegment {
	const head: THREE.Vector3 = bone.getWorldCenter();
	const connected_child: ArmatureBone | undefined = bone.children.find((child: ArmatureBone) => child instanceof ArmatureBone && child.connected);
	const offset: THREE.Vector3 = connected_child
		? new THREE.Vector3().fromArray(connected_child.origin)
		: new THREE.Vector3(0, bone.length, 0);
	const tail: THREE.Vector3 = bone.mesh.localToWorld(offset);
	return { bone, head, tail };
}

function closestPointOnSegment(segment: BoneSegment, point: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
	const axis: THREE.Vector3 = new THREE.Vector3().subVectors(segment.tail, segment.head);
	const length_sq: number = axis.lengthSq();
	let t: number = length_sq > 1e-12 ? new THREE.Vector3().subVectors(point, segment.head).dot(axis) / length_sq : 0;
	t = Math.min(1, Math.max(0, t));
	return target.copy(segment.head).addScaledVector(axis, t);
}

function collectSurface(mesh: Mesh): SurfaceData {
	const vertex_keys: string[] = Object.keys(mesh.vertices);
	const index_of: Map<string, number> = new Map();
	vertex_keys.forEach((key: string, i: number) => index_of.set(key, i));
	const positions: THREE.Vector3[] = vertex_keys.map((key: string) =>
		mesh.scene_object.localToWorld(new THREE.Vector3().fromArray(mesh.vertices[key]))
	);
	const triangles: number[] = [];
	for (const face_key in mesh.faces) {
		const face: MeshFace = mesh.faces[face_key];
		const sorted: string[] = face.getSortedVertices();
		for (let k: number = 1; k < sorted.length - 1; k++) {
			triangles.push(index_of.get(sorted[0]) as number, index_of.get(sorted[k]) as number, index_of.get(sorted[k + 1]) as number);
		}
	}

	const normals: THREE.Vector3[] = positions.map(() => new THREE.Vector3());
	const areas: Float64Array = new Float64Array(positions.length);
	const edge_weights: Map<number, number>[] = positions.map(() => new Map());
	const a: THREE.Vector3 = new THREE.Vector3();
	const b: THREE.Vector3 = new THREE.Vector3();
	const c: THREE.Vector3 = new THREE.Vector3();
	for (let t: number = 0; t < triangles.length; t += 3) {
		const ids: number[] = [triangles[t], triangles[t + 1], triangles[t + 2]];
		const p: THREE.Vector3[] = ids.map((i: number) => positions[i]);
		const normal: THREE.Vector3 = a.subVectors(p[1], p[0]).cross(b.subVectors(p[2], p[0]));
		const double_area: number = normal.length();
		if (double_area < 1e-12) continue;
		for (const i of ids) {
			normals[i].add(normal);
			areas[i] += double_area / 6;
		}
		for (let k: number = 0; k < 3; k++) {
			const i: number = ids[k];
			const j: number = ids[(k + 1) % 3];
			const o: number = ids[(k + 2) % 3];
			const e1: THREE.Vector3 = b.subVectors(positions[i], positions[o]);
			const e2: THREE.Vector3 = c.subVectors(positions[j], positions[o]);
			const cot: number = e1.dot(e2) / double_area;
			const w: number = Math.max(cot / 2, 0);
			edge_weights[i].set(j, (edge_weights[i].get(j) ?? 0) + w);
			edge_weights[j].set(i, (edge_weights[j].get(i) ?? 0) + w);
		}
	}
	normals.forEach((n: THREE.Vector3) => n.normalize());
	const neighbors: number[][] = [];
	const cotangents: number[][] = [];
	edge_weights.forEach((map: Map<number, number>) => {
		neighbors.push(Array.from(map.keys()));
		cotangents.push(Array.from(map.values()).map((w: number) => Math.max(w, 1e-4)));
	});
	return { vertex_keys, positions, normals, triangles, areas, neighbors, cotangents };
}

/** True when the segment from `from` to `to` crosses a triangle that does not use the given vertex */
function segmentBlocked(surface: SurfaceData, vertex: number, from: THREE.Vector3, to: THREE.Vector3): boolean {
	const direction: THREE.Vector3 = new THREE.Vector3().subVectors(to, from);
	const e1: THREE.Vector3 = new THREE.Vector3();
	const e2: THREE.Vector3 = new THREE.Vector3();
	const p: THREE.Vector3 = new THREE.Vector3();
	const s: THREE.Vector3 = new THREE.Vector3();
	const q: THREE.Vector3 = new THREE.Vector3();
	const tri: number[] = surface.triangles;
	for (let t: number = 0; t < tri.length; t += 3) {
		if (tri[t] == vertex || tri[t + 1] == vertex || tri[t + 2] == vertex) continue;
		const v0: THREE.Vector3 = surface.positions[tri[t]];
		e1.subVectors(surface.positions[tri[t + 1]], v0);
		e2.subVectors(surface.positions[tri[t + 2]], v0);
		p.crossVectors(direction, e2);
		const det: number = e1.dot(p);
		if (Math.abs(det) < 1e-12) continue;
		const inv: number = 1 / det;
		s.subVectors(from, v0);
		const u: number = s.dot(p) * inv;
		if (u < 0 || u > 1) continue;
		q.crossVectors(s, e1);
		const v: number = direction.dot(q) * inv;
		if (v < 0 || u + v > 1) continue;
		const hit: number = e2.dot(q) * inv;
		if (hit > 1e-4 && hit < 1 - 1e-4) return true;
	}
	return false;
}

/**
 * Automatic skinning weights by heat diffusion (Baran and Popovic 2007, "Automatic Rigging and Animation of
 * 3D Characters"). Every vertex is a heat source for its closest visible bone, the heat then diffuses over
 * the surface. Weights follow the shape of the mesh instead of just the distance to the bones.
 *
 * Returns the weight of every bone for every vertex: result[bone index][vertex index].
 */
export function computeHeatWeights(mesh: Mesh, bones: ArmatureBone[], options: HeatWeightOptions): { weights: Float64Array[], vertex_keys: string[] } {
	const surface: SurfaceData = collectSurface(mesh);
	const segments: BoneSegment[] = bones.map(getBoneSegment);
	const vertex_count: number = surface.positions.length;
	const closest: THREE.Vector3 = new THREE.Vector3();
	const from: THREE.Vector3 = new THREE.Vector3();

	// closest (visible) bone for each vertex
	const source_bone: Int32Array = new Int32Array(vertex_count).fill(-1);
	const source_distance: Float64Array = new Float64Array(vertex_count);
	for (let i: number = 0; i < vertex_count; i++) {
		const point: THREE.Vector3 = surface.positions[i];
		const candidates: {bone: number, distance: number}[] = segments.map((segment: BoneSegment, bone: number) => ({
			bone,
			distance: point.distanceTo(closestPointOnSegment(segment, point, closest)),
		})).sort((a, b) => a.distance - b.distance);
		let chosen: {bone: number, distance: number} = candidates[0];
		if (options.check_visibility) {
			from.copy(point).addScaledVector(surface.normals[i], -1e-3);
			for (const candidate of candidates.slice(0, 6)) {
				closestPointOnSegment(segments[candidate.bone], point, closest);
				if (!segmentBlocked(surface, i, from, closest)) {
					chosen = candidate;
					break;
				}
			}
		}
		source_bone[i] = chosen.bone;
		source_distance[i] = chosen.distance;
	}

	// shared system matrix: stiffness (cotangent Laplacian) + heat sources on the diagonal
	const heat: Float64Array = new Float64Array(vertex_count);
	const diagonal: Float64Array = new Float64Array(vertex_count);
	for (let i: number = 0; i < vertex_count; i++) {
		const bone_length: number = segments[source_bone[i]].head.distanceTo(segments[source_bone[i]].tail);
		const distance: number = Math.max(source_distance[i], bone_length * 0.02, 1e-4);
		heat[i] = Math.max(surface.areas[i], 1e-9) * options.locality / (distance * distance);
		let stiffness: number = 0;
		for (const w of surface.cotangents[i]) stiffness += w;
		diagonal[i] = stiffness + heat[i];
	}
	const apply = (x: Float64Array, out: Float64Array): void => {
		for (let i: number = 0; i < vertex_count; i++) {
			let sum: number = heat[i] * x[i];
			const neighbors: number[] = surface.neighbors[i];
			const weights: number[] = surface.cotangents[i];
			for (let k: number = 0; k < neighbors.length; k++) sum += weights[k] * (x[i] - x[neighbors[k]]);
			out[i] = sum;
		}
	};

	const weights: Float64Array[] = [];
	const rhs: Float64Array = new Float64Array(vertex_count);
	for (let b: number = 0; b < bones.length; b++) {
		const solution: Float64Array = new Float64Array(vertex_count);
		let has_source: boolean = false;
		for (let i: number = 0; i < vertex_count; i++) {
			rhs[i] = source_bone[i] == b ? heat[i] : 0;
			if (source_bone[i] == b) has_source = true;
		}
		if (has_source) solveSymmetricCG(apply, diagonal, rhs, solution, 400, 1e-6);
		weights.push(solution);
	}

	// normalize, drop small influences, keep the strongest few
	for (let i: number = 0; i < vertex_count; i++) {
		const ranked: {bone: number, weight: number}[] = [];
		for (let b: number = 0; b < bones.length; b++) {
			if (weights[b][i] > 1e-6) ranked.push({ bone: b, weight: weights[b][i] });
		}
		ranked.sort((x, y) => y.weight - x.weight);
		let total: number = ranked.reduce((sum: number, r) => sum + r.weight, 0);
		let kept = ranked.filter((r) => total > 0 && r.weight / total >= options.prune_threshold).slice(0, options.max_influences);
		if (!kept.length) kept = [{ bone: source_bone[i], weight: 1 }];
		total = kept.reduce((sum: number, r) => sum + r.weight, 0);
		for (let b: number = 0; b < bones.length; b++) weights[b][i] = 0;
		for (const r of kept) weights[r.bone][i] = r.weight / total;
	}
	return { weights, vertex_keys: surface.vertex_keys };
}

export function applyHeatWeights(mesh: Mesh, armature: Armature, options: HeatWeightOptions): void {
	const bones: ArmatureBone[] = armature.getAllBones();
	if (!bones.length) return;
	mesh.preview_controller.updateTransform(mesh);
	armature.getAllBones().forEach((bone: ArmatureBone) => ArmatureBone.preview_controller.updateTransform(bone));
	const { weights, vertex_keys } = computeHeatWeights(mesh, bones, options);
	bones.forEach((bone: ArmatureBone, b: number) => {
		vertex_keys.forEach((key: string, i: number) => {
			bone.setVertexWeight(mesh, key, weights[b][i]);
		});
	});
	Canvas.updateView({ elements: [mesh], element_aspects: { geometry: true } });
}
