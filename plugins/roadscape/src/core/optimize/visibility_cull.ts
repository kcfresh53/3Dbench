import type { PropFace, PropMesh, Vec2, Vec3 } from '../types';

/**
 * Removes faces that no outside viewer can ever see (interior walls, undersides, buried
 * fasteners). Every face is rasterised into an ID buffer from many directions; faces seen
 * from fewer than `minViews` directions are dropped. Materials listed in `transparent`
 * never occlude and are always kept, so alpha-tested grilles still show what is behind them.
 */
export interface CullOptions {
	/** Number of viewing directions spread over the sphere. */
	views: number;
	/** ID buffer size in pixels along each side. */
	resolution: number;
	/** A face survives when it is the nearest surface in at least this many views. */
	minViews: number;
	transparent: string[];
	/**
	 * Which viewers count. A prop that stands on the ground is never seen from below, and one that
	 * hangs from a ceiling is never seen from above, so those faces can go.
	 */
	hemisphere: 'all' | 'up' | 'down';
}

export const DEFAULT_CULL: CullOptions = { views: 160, resolution: 512, minViews: 2, transparent: [], hemisphere: 'all' };

interface ProjectedTri {
	face: number;
	a: Vec3;
	b: Vec3;
	c: Vec3;
}

function fibonacciDirections(count: number, hemisphere: CullOptions['hemisphere']): Vec3[] {
	const result: Vec3[] = [];
	const golden: number = Math.PI * (3 - Math.sqrt(5));
	for (let i: number = 0; i < count; i++) {
		const y: number = 1 - (2 * (i + 0.5)) / count;
		const radius: number = Math.sqrt(1 - y * y);
		const theta: number = golden * i;
		// Directions point from the viewer into the scene: a viewer above the prop looks along -Y.
		if (hemisphere === 'up' && y > 0.02) continue;
		if (hemisphere === 'down' && y < -0.02) continue;
		result.push([Math.cos(theta) * radius, y, Math.sin(theta) * radius]);
	}
	return result;
}

function basisFor(direction: Vec3): [Vec3, Vec3] {
	const helper: Vec3 = Math.abs(direction[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
	const u: Vec3 = [
		helper[1] * direction[2] - helper[2] * direction[1],
		helper[2] * direction[0] - helper[0] * direction[2],
		helper[0] * direction[1] - helper[1] * direction[0],
	];
	const ul: number = Math.hypot(u[0], u[1], u[2]);
	const un: Vec3 = [u[0] / ul, u[1] / ul, u[2] / ul];
	const v: Vec3 = [
		direction[1] * un[2] - direction[2] * un[1],
		direction[2] * un[0] - direction[0] * un[2],
		direction[0] * un[1] - direction[1] * un[0],
	];
	return [un, v];
}

export function cullHiddenFaces(mesh: PropMesh, partial: Partial<CullOptions> = {}): { mesh: PropMesh; removed: number } {
	const options: CullOptions = { ...DEFAULT_CULL, ...partial };
	const transparent: Set<string> = new Set(options.transparent);
	const size: number = options.resolution;
	let radius: number = 1e-6;
	const center: Vec3 = [0, 0, 0];
	for (const p of mesh.positions) for (let k: number = 0; k < 3; k++) center[k] += p[k] / mesh.positions.length;
	for (const p of mesh.positions) radius = Math.max(radius, Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]));
	const tris: Array<{ face: number; i: [number, number, number] }> = [];
	mesh.faces.forEach((face: PropFace, id: number): void => {
		if (transparent.has(face.material)) return;
		for (let i: number = 1; i < face.indices.length - 1; i++) tris.push({ face: id, i: [face.indices[0], face.indices[i], face.indices[i + 1]] });
	});
	const seen: Int32Array = new Int32Array(mesh.faces.length);
	const depth: Float32Array = new Float32Array(size * size);
	const ids: Int32Array = new Int32Array(size * size);
	const projected: ProjectedTri[] = [];
	const scale: number = (size - 2) / (2 * radius);
	for (const direction of fibonacciDirections(options.views * (options.hemisphere === 'all' ? 1 : 2), options.hemisphere)) {
		const [bu, bv]: [Vec3, Vec3] = basisFor(direction);
		const proj: Vec3[] = mesh.positions.map((p: Vec3): Vec3 => {
			const x: number = p[0] - center[0];
			const y: number = p[1] - center[1];
			const z: number = p[2] - center[2];
			return [
				(x * bu[0] + y * bu[1] + z * bu[2] + radius) * scale + 1,
				(x * bv[0] + y * bv[1] + z * bv[2] + radius) * scale + 1,
				x * direction[0] + y * direction[1] + z * direction[2],
			];
		});
		depth.fill(Infinity);
		ids.fill(-1);
		projected.length = 0;
		for (const t of tris) projected.push({ face: t.face, a: proj[t.i[0]], b: proj[t.i[1]], c: proj[t.i[2]] });
		for (const t of projected) {
			const minX: number = Math.max(0, Math.floor(Math.min(t.a[0], t.b[0], t.c[0])));
			const maxX: number = Math.min(size - 1, Math.ceil(Math.max(t.a[0], t.b[0], t.c[0])));
			const minY: number = Math.max(0, Math.floor(Math.min(t.a[1], t.b[1], t.c[1])));
			const maxY: number = Math.min(size - 1, Math.ceil(Math.max(t.a[1], t.b[1], t.c[1])));
			const det: number = (t.b[1] - t.c[1]) * (t.a[0] - t.c[0]) + (t.c[0] - t.b[0]) * (t.a[1] - t.c[1]);
			if (Math.abs(det) < 1e-9) continue;
			for (let y: number = minY; y <= maxY; y++) {
				for (let x: number = minX; x <= maxX; x++) {
					const px: number = x + 0.5;
					const py: number = y + 0.5;
					const l1: number = ((t.b[1] - t.c[1]) * (px - t.c[0]) + (t.c[0] - t.b[0]) * (py - t.c[1])) / det;
					const l2: number = ((t.c[1] - t.a[1]) * (px - t.c[0]) + (t.a[0] - t.c[0]) * (py - t.c[1])) / det;
					const l3: number = 1 - l1 - l2;
					const e: number = -1e-4;
					if (l1 < e || l2 < e || l3 < e) continue;
					const z: number = l1 * t.a[2] + l2 * t.b[2] + l3 * t.c[2];
					const slot: number = y * size + x;
					// Viewer sits at -direction looking along +direction: smaller z is nearer.
					if (z < depth[slot]) {
						depth[slot] = z;
						ids[slot] = t.face;
					}
				}
			}
		}
		const hit: Set<number> = new Set();
		for (let i: number = 0; i < ids.length; i++) if (ids[i] >= 0) hit.add(ids[i]);
		for (const id of hit) seen[id]++;
	}
	const faces: PropFace[] = mesh.faces.filter((face: PropFace, id: number): boolean => transparent.has(face.material) || seen[id] >= options.minViews);
	const used: Map<number, number> = new Map();
	const positions: Vec3[] = [];
	const remapped: PropFace[] = faces.map((face: PropFace): PropFace => ({
		material: face.material,
		uvs: face.uvs.map((u: Vec2): Vec2 => [u[0], u[1]]),
		indices: face.indices.map((i: number): number => {
			let index: number | undefined = used.get(i);
			if (index === undefined) {
				index = positions.length;
				positions.push([mesh.positions[i][0], mesh.positions[i][1], mesh.positions[i][2]]);
				used.set(i, index);
			}
			return index;
		}),
	}));
	return { mesh: { positions, faces: remapped }, removed: mesh.faces.length - faces.length };
}
