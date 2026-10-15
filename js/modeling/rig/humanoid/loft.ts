import { MeshSpec } from './humanoid_types';
import { Vec3, add, cross, dot, lerp, normalize, scale, smoothstep, sub, length } from './vec';

export interface Ring {
	center: Vec3
	axis_u: Vec3
	axis_v: Vec3
	radius_u: number
	radius_v: number
	weights: Record<string, number>
}

export interface ChainBone {
	id: string
	head: Vec3
	tail: Vec3
}

/**
 * Computes bone weights for a point near a chain of bones. Weights are rigid along a bone and blend with the
 * neighbor within a zone around each joint.
 */
export function chainWeights(chain: ChainBone[], point: Vec3, blend: number): Record<string, number> {
	const lengths: number[] = chain.map((b: ChainBone) => Math.max(1e-6, length(sub(b.tail, b.head))));
	const starts: number[] = [];
	let total: number = 0;
	for (const l of lengths) {
		starts.push(total);
		total += l;
	}
	// project onto the polyline
	let best_distance: number = Infinity;
	let s: number = 0;
	chain.forEach((bone: ChainBone, i: number) => {
		const axis: Vec3 = sub(bone.tail, bone.head);
		const t: number = Math.min(1, Math.max(0, dot(sub(point, bone.head), axis) / (lengths[i] * lengths[i])));
		const d: number = length(sub(point, add(bone.head, scale(axis, t))));
		if (d < best_distance - 1e-9) {
			best_distance = d;
			s = starts[i] + t * lengths[i];
		}
	});
	let owner: number = chain.length - 1;
	for (let i: number = 0; i < chain.length; i++) {
		if (s <= starts[i] + lengths[i]) { owner = i; break; }
	}
	for (let j: number = 1; j < chain.length; j++) {
		const half_width: number = blend * Math.min(lengths[j - 1], lengths[j]);
		if (half_width < 1e-6) continue;
		if (Math.abs(s - starts[j]) < half_width) {
			const alpha: number = smoothstep((s - (starts[j] - half_width)) / (2 * half_width));
			const result: Record<string, number> = {};
			result[chain[j - 1].id] = 1 - alpha;
			result[chain[j].id] = alpha;
			return result;
		}
	}
	return { [chain[owner].id]: 1 };
}

/** Builds orthonormal ring axes for a ring whose plane is perpendicular to the tangent. */
export function ringAxes(tangent: Vec3, up_hint: Vec3): [Vec3, Vec3] {
	let u: Vec3 = cross(up_hint, tangent);
	if (Math.hypot(u[0], u[1], u[2]) < 1e-6) u = cross([1, 0, 0], tangent);
	u = normalize(u);
	const v: Vec3 = normalize(cross(tangent, u));
	return [u, v];
}

function ringPoints(ring: Ring, sides: number): Vec3[] {
	const points: Vec3[] = [];
	for (let k: number = 0; k < sides; k++) {
		let cu: number;
		let cv: number;
		if (sides == 4) {
			// box corners
			cu = [1, -1, -1, 1][k];
			cv = [1, 1, -1, -1][k];
		} else {
			const angle: number = (k / sides) * Math.PI * 2;
			cu = Math.cos(angle);
			cv = Math.sin(angle);
		}
		points.push(add(ring.center, add(scale(ring.axis_u, cu * ring.radius_u), scale(ring.axis_v, cv * ring.radius_v))));
	}
	return points;
}

function newell(points: Vec3[]): Vec3 {
	let n: Vec3 = [0, 0, 0];
	for (let i: number = 0; i < points.length; i++) {
		const a: Vec3 = points[i];
		const b: Vec3 = points[(i + 1) % points.length];
		n = add(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
	}
	return n;
}

/**
 * Lofts a sequence of rings into a closed polygon mesh, quads on the sides and caps on both ends.
 * Face winding is corrected to point away from the loft axis.
 */
export function loftRings(name: string, rings: Ring[], sides: number): MeshSpec {
	const mesh: MeshSpec = { name, vertices: [], vertex_weights: [], faces: [] };
	if (rings.length < 2) return mesh;
	const ring_vertices: number[][] = rings.map((ring: Ring) => {
		const indices: number[] = [];
		for (const p of ringPoints(ring, sides)) {
			indices.push(mesh.vertices.length);
			mesh.vertices.push(p);
			mesh.vertex_weights.push({ ...ring.weights });
		}
		return indices;
	});

	const addFace = (indices: number[], outward: Vec3): void => {
		const normal: Vec3 = newell(indices.map((i: number) => mesh.vertices[i]));
		mesh.faces.push(dot(normal, outward) < 0 ? indices.slice().reverse() : indices);
	};

	for (let r: number = 0; r < rings.length - 1; r++) {
		const mid_axis: Vec3 = lerp(rings[r].center, rings[r + 1].center, 0.5);
		for (let k: number = 0; k < sides; k++) {
			const k2: number = (k + 1) % sides;
			const face: number[] = [ring_vertices[r][k], ring_vertices[r][k2], ring_vertices[r + 1][k2], ring_vertices[r + 1][k]];
			const centroid: Vec3 = scale(face.map((i: number) => mesh.vertices[i]).reduce((a: Vec3, b: Vec3) => add(a, b), [0, 0, 0] as Vec3), 0.25);
			addFace(face, sub(centroid, mid_axis));
		}
	}

	const capFace = (ring_index: number, outward: Vec3): void => {
		const indices: number[] = ring_vertices[ring_index];
		if (sides == 4) {
			addFace(indices.slice(), outward);
			return;
		}
		const center_index: number = mesh.vertices.length;
		mesh.vertices.push(rings[ring_index].center);
		mesh.vertex_weights.push({ ...rings[ring_index].weights });
		for (let k: number = 0; k < sides; k++) {
			addFace([indices[k], indices[(k + 1) % sides], center_index], outward);
		}
	};
	capFace(0, normalize(sub(rings[0].center, rings[1].center)));
	const last: number = rings.length - 1;
	capFace(last, normalize(sub(rings[last].center, rings[last - 1].center)));
	return mesh;
}

export function mergeMeshes(name: string, meshes: MeshSpec[]): MeshSpec {
	const result: MeshSpec = { name, vertices: [], vertex_weights: [], faces: [] };
	for (const mesh of meshes) {
		const offset: number = result.vertices.length;
		result.vertices.push(...mesh.vertices);
		result.vertex_weights.push(...mesh.vertex_weights);
		for (const face of mesh.faces) result.faces.push(face.map((i: number) => i + offset));
	}
	return result;
}
