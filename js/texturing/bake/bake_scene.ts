import { TriangleBVH } from './bvh';

/**
 * Flattened, world space triangle soup of the meshes that are baked.
 * Everything is stored in typed arrays so passes can run allocation free.
 */
export class BakeScene {
	/** 9 floats per triangle: world positions */
	readonly tri_pos: Float32Array;
	/** 9 floats per triangle: world normals per corner */
	readonly tri_nrm: Float32Array;
	/** 6 floats per triangle: UV in 0-1 space, v pointing down (image space) */
	readonly tri_uv: Float32Array;
	/** 3 floats per triangle: normalized mean curvature per corner. Positive = convex */
	readonly tri_curv: Float32Array;
	/** Index of the source mesh per triangle */
	readonly tri_mesh: Int32Array;
	readonly mesh_count: number;
	readonly min: [number, number, number] = [Infinity, Infinity, Infinity];
	readonly max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
	/** Length of the bounding box diagonal */
	readonly diagonal: number;
	private _bvh: TriangleBVH | null = null;

	get triangle_count(): number {
		return this.tri_mesh.length;
	}
	get bvh(): TriangleBVH {
		if (!this._bvh) this._bvh = new TriangleBVH(this.tri_pos);
		return this._bvh;
	}

	constructor(meshes: Mesh[], smooth_normals: boolean, uv_width: number, uv_height: number) {
		const pos: number[] = [], nrm: number[] = [], uvs: number[] = [], curv: number[] = [], owner: number[] = [];
		let edge_length_sum: number = 0, edge_count: number = 0;
		const world_normal_matrix: THREE.Matrix3 = new THREE.Matrix3();

		meshes.forEach((mesh: Mesh, mesh_index: number) => {
			const object: THREE.Object3D | undefined = mesh.mesh;
			if (object) object.updateMatrixWorld(true);
			const matrix: THREE.Matrix4 = object ? object.matrixWorld : new THREE.Matrix4();
			world_normal_matrix.getNormalMatrix(matrix);
			const mirrored: boolean = matrix.determinant() < 0;
			const vector: THREE.Vector3 = new THREE.Vector3();

			const world: Map<string, THREE.Vector3> = new Map();
			for (const key in mesh.vertices) {
				world.set(key, vector.fromArray(mesh.vertices[key]).applyMatrix4(matrix).clone());
			}

			// Triangulate faces
			interface Tri { keys: [string, string, string], face_key: string }
			const tris: Tri[] = [];
			for (const face_key in mesh.faces) {
				const face: MeshFace = mesh.faces[face_key];
				const keys: string[] = face.getSortedVertices();
				for (let k: number = 1; k < keys.length - 1; k++) {
					tris.push({keys: [keys[0], keys[k], keys[k + 1]], face_key});
				}
			}

			// Area weighted smooth vertex normals, always computed because curvature needs them
			const vertex_normal: Map<string, THREE.Vector3> = new Map();
			const tri_normal: THREE.Vector3[] = tris.map((tri: Tri) => {
				const a: THREE.Vector3 = world.get(tri.keys[0]) as THREE.Vector3;
				const b: THREE.Vector3 = world.get(tri.keys[1]) as THREE.Vector3;
				const c: THREE.Vector3 = world.get(tri.keys[2]) as THREE.Vector3;
				const n: THREE.Vector3 = b.clone().sub(a).cross(c.clone().sub(a));
				if (mirrored) n.negate();
				for (const key of tri.keys) {
					const sum: THREE.Vector3 = vertex_normal.get(key) ?? new THREE.Vector3();
					sum.add(n);
					vertex_normal.set(key, sum);
				}
				return n.clone().normalize();
			});
			vertex_normal.forEach((n: THREE.Vector3) => n.normalize());

			// Mean curvature estimate per vertex from the normal change along its edges
			const curvature_sum: Map<string, number> = new Map();
			const curvature_count: Map<string, number> = new Map();
			const seen_edges: Set<string> = new Set();
			for (const tri of tris) {
				for (let e: number = 0; e < 3; e++) {
					const ka: string = tri.keys[e], kb: string = tri.keys[(e + 1) % 3];
					const edge_id: string = ka < kb ? ka + '|' + kb : kb + '|' + ka;
					if (seen_edges.has(edge_id)) continue;
					seen_edges.add(edge_id);
					const pa: THREE.Vector3 = world.get(ka) as THREE.Vector3, pb: THREE.Vector3 = world.get(kb) as THREE.Vector3;
					const d: THREE.Vector3 = pb.clone().sub(pa);
					const len2: number = d.lengthSq();
					if (len2 < 1e-12) continue;
					edge_length_sum += Math.sqrt(len2);
					edge_count++;
					const dn: THREE.Vector3 = (vertex_normal.get(kb) as THREE.Vector3).clone().sub(vertex_normal.get(ka) as THREE.Vector3);
					const c: number = dn.dot(d) / len2;
					for (const key of [ka, kb]) {
						curvature_sum.set(key, (curvature_sum.get(key) ?? 0) + c);
						curvature_count.set(key, (curvature_count.get(key) ?? 0) + 1);
					}
				}
			}

			tris.forEach((tri: Tri, t: number) => {
				const face: MeshFace = mesh.faces[tri.face_key];
				for (const key of tri.keys) {
					const p: THREE.Vector3 = world.get(key) as THREE.Vector3;
					pos.push(p.x, p.y, p.z);
					const n: THREE.Vector3 = smooth_normals ? vertex_normal.get(key) as THREE.Vector3 : tri_normal[t];
					nrm.push(n.x, n.y, n.z);
					const uv: [number, number] = face.uv[key] ?? [0, 0];
					uvs.push(uv[0] / uv_width, uv[1] / uv_height);
					curv.push((curvature_sum.get(key) ?? 0) / (curvature_count.get(key) || 1));
					for (let k: number = 0; k < 3; k++) {
						const value: number = k == 0 ? p.x : k == 1 ? p.y : p.z;
						if (value < this.min[k]) this.min[k] = value;
						if (value > this.max[k]) this.max[k] = value;
					}
				}
				owner.push(mesh_index);
			});
		});

		// Curvature is stored dimensionless by scaling with the mean edge length
		const mean_edge: number = edge_count ? edge_length_sum / edge_count : 1;
		this.tri_pos = Float32Array.from(pos);
		this.tri_nrm = Float32Array.from(nrm);
		this.tri_uv = Float32Array.from(uvs);
		this.tri_curv = Float32Array.from(curv.map((c: number) => c * mean_edge));
		this.tri_mesh = Int32Array.from(owner);
		this.mesh_count = meshes.length;
		this.diagonal = owner.length ? Math.hypot(this.max[0] - this.min[0], this.max[1] - this.min[1], this.max[2] - this.min[2]) : 1;
	}
}

export interface UVRaster {
	width: number
	height: number
	/** Triangle covering each texel, -1 where the UV map is empty */
	tri: Int32Array
	/** 3 barycentric weights per texel */
	bary: Float32Array
}

/** Rasterizes the UV layout of all scene triangles into a texel grid. */
export function rasterizeUVs(scene: BakeScene, width: number, height: number): UVRaster {
	const tri: Int32Array = new Int32Array(width * height).fill(-1);
	const bary: Float32Array = new Float32Array(width * height * 3);
	const eps: number = -1e-4;
	for (let t: number = 0; t < scene.triangle_count; t++) {
		const i: number = t * 6;
		const x0: number = scene.tri_uv[i] * width, y0: number = scene.tri_uv[i + 1] * height;
		const x1: number = scene.tri_uv[i + 2] * width, y1: number = scene.tri_uv[i + 3] * height;
		const x2: number = scene.tri_uv[i + 4] * width, y2: number = scene.tri_uv[i + 5] * height;
		const area: number = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
		if (Math.abs(area) < 1e-9) continue;
		const inv_area: number = 1 / area;
		const min_x: number = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
		const max_x: number = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)));
		const min_y: number = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
		const max_y: number = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)));
		for (let y: number = min_y; y <= max_y; y++) {
			for (let x: number = min_x; x <= max_x; x++) {
				const px: number = x + 0.5, py: number = y + 0.5;
				const b1: number = ((px - x0) * (y2 - y0) - (x2 - x0) * (py - y0)) * inv_area;
				const b2: number = ((x1 - x0) * (py - y0) - (px - x0) * (y1 - y0)) * inv_area;
				const b0: number = 1 - b1 - b2;
				if (b0 < eps || b1 < eps || b2 < eps) continue;
				const index: number = y * width + x;
				tri[index] = t;
				bary[index * 3] = b0;
				bary[index * 3 + 1] = b1;
				bary[index * 3 + 2] = b2;
			}
		}
	}
	return {width, height, tri, bary};
}
