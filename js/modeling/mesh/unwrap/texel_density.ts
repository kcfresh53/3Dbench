import { collectUVIslands, getTargetFaces, packExistingIslands, UVIsland } from './mesh_unwrap';
import type { Vec2 } from './types';

export interface TexelDensityOptions {
	/** Pixels per model unit. 0 = use the area weighted average of the current islands */
	target: number
	/** Repack the scaled islands so they fit into the texture */
	repack: boolean
	margin: number
	allow_rotation: boolean
	selection_only: boolean
	uv_width: number
	uv_height: number
}

export interface TexelDensityReport {
	island_count: number
	/** Density all islands were scaled to, pixels per unit */
	density: number
	/** Ratio between the densest and the sparsest island before the operation */
	spread_before: number
}

interface IslandMeasure {
	island: UVIsland
	uv_area: number
	world_area: number
	center: Vec2
}

function triangleArea3D(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
	return b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
}

function measureIsland(island: UVIsland, matrix: THREE.Matrix4): IslandMeasure {
	let uv_area: number = 0;
	const tris: Float64Array = island.tris;
	let min_u: number = Infinity, min_v: number = Infinity, max_u: number = -Infinity, max_v: number = -Infinity;
	for (let i: number = 0; i < tris.length; i += 6) {
		uv_area += Math.abs((tris[i + 2] - tris[i]) * (tris[i + 5] - tris[i + 1]) - (tris[i + 4] - tris[i]) * (tris[i + 3] - tris[i + 1])) / 2;
		for (let k: number = 0; k < 6; k += 2) {
			min_u = Math.min(min_u, tris[i + k]); max_u = Math.max(max_u, tris[i + k]);
			min_v = Math.min(min_v, tris[i + k + 1]); max_v = Math.max(max_v, tris[i + k + 1]);
		}
	}
	let world_area: number = 0;
	for (const key of island.face_keys) {
		const face: MeshFace = island.mesh.faces[key];
		const points: THREE.Vector3[] = face.getSortedVertices().map((vk: string) => new THREE.Vector3().fromArray(island.mesh.vertices[vk]).applyMatrix4(matrix));
		for (let k: number = 1; k < points.length - 1; k++) world_area += triangleArea3D(points[0], points[k], points[k + 1]);
	}
	return {island, uv_area, world_area, center: [(min_u + max_u) / 2, (min_v + max_v) / 2]};
}

/**
 * Scales every UV island so that all of them have the same number of texture pixels per model unit.
 * Without this, islands drawn at different scales show different texture sharpness on the model.
 */
export function equalizeTexelDensity(meshes: Mesh[], options: TexelDensityOptions): TexelDensityReport {
	const measures: IslandMeasure[] = [];
	for (const mesh of meshes) {
		if (mesh.mesh) mesh.mesh.updateMatrixWorld(true);
		const matrix: THREE.Matrix4 = mesh.mesh ? mesh.mesh.matrixWorld : new THREE.Matrix4();
		for (const island of collectUVIslands(mesh, getTargetFaces(mesh, options.selection_only))) {
			const m: IslandMeasure = measureIsland(island, matrix);
			if (m.uv_area > 1e-9 && m.world_area > 1e-9) measures.push(m);
		}
	}
	if (!measures.length) return {island_count: 0, density: 0, spread_before: 1};

	const densities: number[] = measures.map((m: IslandMeasure) => Math.sqrt(m.uv_area / m.world_area));
	let target: number = options.target;
	if (!(target > 0)) {
		let weighted: number = 0, total: number = 0;
		measures.forEach((m: IslandMeasure, i: number) => { weighted += densities[i] * m.world_area; total += m.world_area; });
		target = weighted / total;
	}
	const spread_before: number = Math.max(...densities) / Math.min(...densities);

	measures.forEach((m: IslandMeasure, i: number) => {
		const factor: number = target / densities[i];
		for (const key of m.island.face_keys) {
			const face: MeshFace = m.island.mesh.faces[key];
			for (const vk of face.vertices) {
				const uv: Vec2 | undefined = face.uv[vk];
				if (!uv) continue;
				face.uv[vk] = [m.center[0] + (uv[0] - m.center[0]) * factor, m.center[1] + (uv[1] - m.center[1]) * factor];
			}
		}
	});

	if (options.repack) {
		packExistingIslands(meshes, {
			margin: options.margin, allow_rotation: options.allow_rotation, keep_scale: true,
			uv_width: options.uv_width, uv_height: options.uv_height,
		}, options.selection_only);
	}
	return {island_count: measures.length, density: target, spread_before};
}
