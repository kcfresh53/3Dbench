import assert from 'node:assert/strict';
import type { MeshPart, PartFace, Vec3 } from '../src/core/types';
import { triangleCount } from '../src/core/types';
import type { RoadNetwork } from '../src/core/model';
import { addNode, addSegment, createNetwork } from '../src/core/network';
import type { TreeAsset, TreeProvider } from '../src/core/context';
import type { TreeSpecLike } from '../src/core/types';
import { cross, dot, sub } from '../src/core/vec';
import { polygonNormal } from '../src/core/part_set';

export function network(profile: string, nodes: Array<[string, Vec3]>, links: Array<[string, string]>): RoadNetwork {
	const n: RoadNetwork = createNetwork({ defaultProfile: profile });
	for (const [id, p] of nodes) addNode(n, id, p);
	for (const [a, b] of links) addSegment(n, a, b);
	return n;
}

export function crossroad(profile: string = 'street', arm: number = 60): RoadNetwork {
	return network(
		profile,
		[['c', [0, 0, 0]], ['n', [0, 0, -arm]], ['s', [0, 0, arm]], ['e', [arm, 0, 0]], ['w', [-arm, 0, 0]]],
		[['c', 'n'], ['c', 's'], ['c', 'e'], ['c', 'w']],
	);
}

/** Cheap stand-in for the tree generator: a crossed pair of quads, a few triangles per tree. */
export class FakeTrees implements TreeProvider {
	revision: number = 1;
	assets(spec: TreeSpecLike, unit: number): TreeAsset[] {
		const h: number = spec.height * unit;
		const w: number = h * 0.3;
		const uv: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
		const positions: Vec3[] = [[-w, 0, 0], [w, 0, 0], [w, h, 0], [-w, h, 0], [0, 0, -w], [0, 0, w], [0, h, w], [0, h, -w]];
		const faces: PartFace[] = [
			{ indices: [0, 1, 2, 3], uvs: uv },
			{ indices: [4, 5, 6, 7], uvs: uv },
		];
		return [{ key: 'tree:fake', positions, faces, height: h, triangles: 4 }];
	}
}

export function checkParts(parts: MeshPart[]): number {
	let triangles: number = 0;
	for (const part of parts) {
		for (const p of part.positions) assert.ok(p.length === 3 && p.every(Number.isFinite), `Non-finite vertex in ${part.name}`);
		for (const face of part.faces) {
			assert.ok(face.indices.length >= 3 && face.indices.length <= 4, `${part.name}: bad corner count`);
			assert.equal(new Set(face.indices).size, face.indices.length, `${part.name}: repeated corner`);
			assert.equal(face.indices.length, face.uvs.length);
			for (const i of face.indices) assert.ok(Number.isInteger(i) && i >= 0 && i < part.positions.length);
			for (const uv of face.uvs) assert.ok(uv.every((v: number): boolean => Number.isFinite(v) && v >= -1e-9 && v <= 1 + 1e-9), `${part.name}: UV outside the atlas`);
		}
		triangles += triangleCount(part.faces);
	}
	return triangles;
}

export function faceNormalOf(part: MeshPart, face: PartFace): Vec3 {
	return polygonNormal(face.indices.map((i: number): Vec3 => part.positions[i]));
}

/** Fraction of a part's face area that points upward. */
export function upwardShare(part: MeshPart): number {
	let up: number = 0;
	let total: number = 0;
	for (const face of part.faces) {
		const n: Vec3 = faceNormalOf(part, face);
		const area: number = Math.hypot(n[0], n[1], n[2]) / 2;
		total += area;
		if (n[1] > 0) up += area;
	}
	return total > 0 ? up / total : 1;
}

/** Edges used by exactly one face (open boundary) and by more than two faces (non-manifold). */
export function edgeStats(part: MeshPart): { open: number; overshared: number } {
	const counts: Map<string, number> = new Map();
	for (const face of part.faces) {
		for (let i: number = 0; i < face.indices.length; i++) {
			const a: number = face.indices[i];
			const b: number = face.indices[(i + 1) % face.indices.length];
			const key: string = a < b ? `${a},${b}` : `${b},${a}`;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	let open: number = 0;
	let overshared: number = 0;
	for (const c of counts.values()) {
		if (c === 1) open++;
		if (c > 2) overshared++;
	}
	return { open, overshared };
}

export function bounds(parts: MeshPart[]): { min: Vec3; max: Vec3 } {
	const min: Vec3 = [Infinity, Infinity, Infinity];
	const max: Vec3 = [-Infinity, -Infinity, -Infinity];
	for (const part of parts) {
		for (const p of part.positions) {
			for (let i: number = 0; i < 3; i++) {
				min[i] = Math.min(min[i], p[i]);
				max[i] = Math.max(max[i], p[i]);
			}
		}
	}
	return { min, max };
}

export { cross, dot, sub };
