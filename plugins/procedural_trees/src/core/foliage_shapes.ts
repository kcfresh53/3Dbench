import type { Vec2, Vec3 } from './types';
import { MeshBuilder } from './mesh_builder';
import { Rng } from './rng';
import { add, cross, normalize, perpendicular, rotateAroundAxis, scale, sub } from './math';
import { LEAF_CARD_UV, SOLID_UV, quadUvs } from './uv_layout';
import { planarFaceUvs } from './uv_project';

/** A volume of individually oriented alpha-cut leaves or needle sprigs. */
export function addCardCluster(
	mb: MeshBuilder,
	center: Vec3,
	size: number,
	planes: number,
	rng: Rng,
): void {
	// A spray consists of small leaves in different planes, distributed throughout
	// a volume. Crossed vertical billboards read as repeated flat hedge panels.
	const leaves = Math.max(5, planes * 12);
	const uvs = quadUvs(LEAF_CARD_UV);
	for (let k = 0; k < leaves; k++) {
		const radial = rng.unitVector();
		const distance = Math.cbrt(rng.next()) * size * 0.48;
		const position = add(center, [radial[0]*distance, radial[1]*distance*0.65, radial[2]*distance]);
		const normal = normalize(add(radial, [0, 0.7, 0]));
		const right = rotateAroundAxis(perpendicular(normal), normal, rng.range(0, Math.PI*2));
		const up = cross(normal, right);
		const width = size * rng.range(0.19, 0.31);
		const height = width * rng.range(0.75, 1.1);
		const corners = [
			sub(sub(position, scale(right,width/2)), scale(up,height/2)),
			sub(add(position, scale(right,width/2)), scale(up,height/2)),
			add(add(position, scale(right,width/2)), scale(up,height/2)),
			add(sub(position, scale(right,width/2)), scale(up,height/2)),
		];
		mb.addFace(corners.map(p => mb.addVertex(p)), uvs.map(uv => [...uv] as Vec2));
	}
}

/** Original crossed-card clusters for the stylized look. */
export function addStylizedCardCluster(mb: MeshBuilder, center: Vec3, size: number, planes: number, rng: Rng): void {
	const baseYaw = rng.range(0, Math.PI);
	const half = size / 2;
	const uvs = quadUvs(LEAF_CARD_UV);
	for (let k = 0; k < planes; k++) {
		const yaw = baseYaw + k * Math.PI / planes;
		const right: Vec3 = [Math.cos(yaw), 0, Math.sin(yaw)];
		const up = rotateAroundAxis([0, 1, 0], right, rng.range(-0.35, 0.35));
		const corners = [
			sub(sub(center, scale(right,half)),scale(up,half)),
			sub(add(center, scale(right,half)),scale(up,half)),
			add(add(center, scale(right,half)),scale(up,half)),
			add(sub(center, scale(right,half)),scale(up,half)),
		];
		mb.addFace(corners.map(p => mb.addVertex(p)), uvs.map(uv => [...uv] as Vec2));
	}
}

interface UnitMesh {
	verts: Vec3[];
	faces: number[][];
}

function buildOctahedron(): UnitMesh {
	const verts: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
	const faces: number[][] = [];
	for (const x of [0, 1]) {
		for (const y of [2, 3]) {
			for (const z of [4, 5]) {
				const negatives: number = (x === 1 ? 1 : 0) + (y === 3 ? 1 : 0) + (z === 5 ? 1 : 0);
				faces.push(negatives % 2 === 1 ? [x, z, y] : [x, y, z]);
			}
		}
	}
	return { verts, faces };
}

function buildIcosahedron(): UnitMesh {
	const t: number = (1 + Math.sqrt(5)) / 2;
	const raw: Vec3[] = [
		[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
		[0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
		[t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
	];
	const faces: number[][] = [
		[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
		[1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
		[3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
		[4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
	];
	return { verts: raw.map(normalize), faces };
}

const OCTAHEDRON: UnitMesh = buildOctahedron();
const ICOSAHEDRON: UnitMesh = buildIcosahedron();

/** Lumpy low-poly leaf blob. Downward faces are dropped on the icosahedron. */
export function addBlob(mb: MeshBuilder, center: Vec3, size: number, detail: number, rng: Rng): void {
	const unit: UnitMesh = detail >= 1 ? ICOSAHEDRON : OCTAHEDRON;
	const radius: number = size / 2;
	const jitter: number[] = unit.verts.map((): number => 1 + rng.range(-0.18, 0.18));
	const created: Map<number, number> = new Map<number, number>();

	const vertexFor = (i: number): number => {
		const existing: number | undefined = created.get(i);
		if (existing !== undefined) return existing;
		const p: Vec3 = unit.verts[i];
		const r: number = radius * jitter[i];
		const index: number = mb.addVertex([center[0] + p[0] * r, center[1] + p[1] * r * 0.8, center[2] + p[2] * r]);
		created.set(i, index);
		return index;
	};

	for (const face of unit.faces) {
		if (detail >= 1) {
			const a: Vec3 = unit.verts[face[0]];
			const b: Vec3 = unit.verts[face[1]];
			const c: Vec3 = unit.verts[face[2]];
			const normal: Vec3 = normalize(cross(sub(b, a), sub(c, a)));
			if (normal[1] < -0.75) continue;
		}
		const indices: number[] = face.map(vertexFor);
		mb.addFace(indices, planarFaceUvs(indices.map((i: number): Vec3 => mb.position(i)), SOLID_UV, rng));
	}
}

/** Open cone skirt (no base cap): `sides` triangles. Used for conifer tiers. */
export function addConeTier(
	mb: MeshBuilder,
	baseCenter: Vec3,
	apex: Vec3,
	radius: number,
	sides: number,
	rotation: number,
	rng: Rng,
): void {
	const ring: number[] = [];
	for (let k = 0; k < sides; k++) {
		const angle: number = rotation + (Math.PI * 2 * k) / sides;
		ring.push(mb.addVertex([baseCenter[0] + Math.cos(angle) * radius, baseCenter[1], baseCenter[2] + Math.sin(angle) * radius]));
	}
	const apexIndex: number = mb.addVertex(apex);
	for (let k = 0; k < sides; k++) {
		// Ring runs clockwise seen from above here, so swap to keep normals outward.
		const indices: number[] = [ring[(k + 1) % sides], ring[k], apexIndex];
		mb.addFace(indices, planarFaceUvs(indices.map((i: number): Vec3 => mb.position(i)), SOLID_UV, rng));
	}
}
