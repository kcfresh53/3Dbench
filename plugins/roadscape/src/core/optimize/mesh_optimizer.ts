import type { PropFace, PropMesh, Vec2, Vec3 } from '../types';

/**
 * Attribute-preserving edge-collapse simplifier for hard-surface props.
 *
 * Every collapse slides one vertex onto a neighbour, so planar regions with a continuous UV
 * mapping reduce losslessly while bevels, bolts and tessellation noise disappear once their
 * geometric error falls under the configured tolerance. Border and UV-seam vertices only move
 * along their own border or seam and carry a penalty quadric, so silhouettes and texture
 * islands keep their shape. UV drift and flipped UV or surface orientation reject a collapse.
 */
export interface OptimizeOptions {
	/** Collapses whose geometric error (model units) stays below this are always accepted. */
	maxError: number;
	/** Keep collapsing past `maxError` until this triangle count is reached; 0 disables. */
	targetTriangles: number;
	/** Absolute error ceiling while chasing `targetTriangles`. */
	hardMaxError: number;
	/** Converts UV drift, measured in model units, into collapse cost. */
	uvWeight: number;
	/** Disconnected pieces with a bounding-box diagonal below this are deleted. */
	dropComponentSize: number;
	/** Multiplier on the quadric that pins open borders (silhouette edges). */
	borderWeight: number;
	/** Multiplier on the quadric that pins UV seams on closed surfaces. */
	seamWeight: number;
}

export interface OptimizeReport {
	trianglesBefore: number;
	trianglesAfter: number;
	verticesBefore: number;
	verticesAfter: number;
	collapses: number;
	droppedComponents: number;
	/** Largest geometric error (model units) that any accepted collapse introduced. */
	finalError: number;
}

export const DEFAULT_OPTIMIZE: OptimizeOptions = {
	maxError: 0.01,
	targetTriangles: 0,
	hardMaxError: 0.05,
	uvWeight: 1,
	dropComponentSize: 0,
	borderWeight: 8,
	seamWeight: 1,
};

interface Tri {
	v: [number, number, number];
	uv: [Vec2, Vec2, Vec2];
	material: number;
	alive: boolean;
}

interface QueueEntry {
	cost: number;
	from: number;
	to: number;
	stampFrom: number;
	stampTo: number;
}

type Quadric = number[];

const UV_EPS: number = 1e-5;
const FLIP_LIMIT: number = 0.3;
const POSITION_QUANTUM: number = 1e5;

function sub(a: Vec3, b: Vec3): Vec3 {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm(a: Vec3): number {
	return Math.hypot(a[0], a[1], a[2]);
}

function uvEqual(a: Vec2, b: Vec2): boolean {
	return Math.abs(a[0] - b[0]) < UV_EPS && Math.abs(a[1] - b[1]) < UV_EPS;
}

function uvArea2(a: Vec2, b: Vec2, c: Vec2): number {
	return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function emptyQuadric(): Quadric {
	return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

function addPlane(q: Quadric, n: Vec3, d: number, weight: number): void {
	q[0] += weight * n[0] * n[0];
	q[1] += weight * n[0] * n[1];
	q[2] += weight * n[0] * n[2];
	q[3] += weight * n[0] * d;
	q[4] += weight * n[1] * n[1];
	q[5] += weight * n[1] * n[2];
	q[6] += weight * n[1] * d;
	q[7] += weight * n[2] * n[2];
	q[8] += weight * n[2] * d;
	q[9] += weight * d * d;
}

function evalQuadric(q: Quadric, p: Vec3): number {
	const x: number = p[0];
	const y: number = p[1];
	const z: number = p[2];
	return (
		q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x +
		q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y +
		q[7] * z * z + 2 * q[8] * z + q[9]
	);
}

class MinHeap {
	private readonly items: QueueEntry[] = [];

	get size(): number {
		return this.items.length;
	}

	push(entry: QueueEntry): void {
		const a: QueueEntry[] = this.items;
		a.push(entry);
		let i: number = a.length - 1;
		while (i > 0) {
			const parent: number = (i - 1) >> 1;
			if (a[parent].cost <= a[i].cost) break;
			[a[parent], a[i]] = [a[i], a[parent]];
			i = parent;
		}
	}

	pop(): QueueEntry | undefined {
		const a: QueueEntry[] = this.items;
		if (a.length === 0) return undefined;
		const top: QueueEntry = a[0];
		const last: QueueEntry = a.pop() as QueueEntry;
		if (a.length > 0) {
			a[0] = last;
			let i: number = 0;
			for (;;) {
				const l: number = i * 2 + 1;
				const r: number = l + 1;
				let m: number = i;
				if (l < a.length && a[l].cost < a[m].cost) m = l;
				if (r < a.length && a[r].cost < a[m].cost) m = r;
				if (m === i) break;
				[a[m], a[i]] = [a[i], a[m]];
				i = m;
			}
		}
		return top;
	}
}

type EdgeKind = 'interior' | 'seam' | 'border' | 'nonmanifold' | 'missing';

class Simplifier {
	readonly positions: Vec3[];
	readonly tris: Tri[] = [];
	readonly vertTris: Set<number>[];
	readonly quadrics: Quadric[];
	private readonly stamp: number[];
	private readonly materials: string[];
	private uvToWorld: number = 1;
	readonly rejections: Map<string, number> = new Map();
	liveTriangles: number = 0;
	collapses: number = 0;
	finalError: number = 0;

	constructor(mesh: PropMesh, private readonly options: OptimizeOptions) {
		const remap: Map<string, number> = new Map();
		const welded: number[] = [];
		this.positions = [];
		for (const p of mesh.positions) {
			const key: string = p.map((c: number): number => Math.round(c * POSITION_QUANTUM)).join(',');
			let index: number | undefined = remap.get(key);
			if (index === undefined) {
				index = this.positions.length;
				this.positions.push([p[0], p[1], p[2]]);
				remap.set(key, index);
			}
			welded.push(index);
		}
		this.materials = [];
		const materialIds: Map<string, number> = new Map();
		const seen: Set<string> = new Set();
		for (const face of mesh.faces) {
			let material: number | undefined = materialIds.get(face.material);
			if (material === undefined) {
				material = this.materials.length;
				this.materials.push(face.material);
				materialIds.set(face.material, material);
			}
			for (const corner of triangulateFace(face, mesh.positions)) {
				const v: [number, number, number] = [welded[face.indices[corner[0]]], welded[face.indices[corner[1]]], welded[face.indices[corner[2]]]];
				if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
				const key: string = [...v].sort((a: number, b: number): number => a - b).join(',') + '|' + material + '|' + v.join(',');
				if (seen.has(key)) continue;
				seen.add(key);
				const uv: [Vec2, Vec2, Vec2] = [face.uvs[corner[0]], face.uvs[corner[1]], face.uvs[corner[2]]].map(
					(u: Vec2): Vec2 => [u[0], u[1]],
				) as [Vec2, Vec2, Vec2];
				if (this.area(v) < 1e-12) continue;
				this.tris.push({ v, uv, material, alive: true });
			}
		}
		this.vertTris = this.positions.map((): Set<number> => new Set());
		this.tris.forEach((t: Tri, i: number): void => {
			for (const v of t.v) this.vertTris[v].add(i);
		});
		this.liveTriangles = this.tris.length;
		this.stamp = this.positions.map((): number => 0);
		this.quadrics = this.positions.map((): Quadric => emptyQuadric());
	}

	// ---- geometry helpers ------------------------------------------------------------------

	private area(v: ArrayLike<number>): number {
		const a: Vec3 = this.positions[v[0]];
		return norm(cross(sub(this.positions[v[1]], a), sub(this.positions[v[2]], a))) / 2;
	}

	private normal(v: ArrayLike<number>): Vec3 {
		const a: Vec3 = this.positions[v[0]];
		const c: Vec3 = cross(sub(this.positions[v[1]], a), sub(this.positions[v[2]], a));
		const length: number = norm(c) || 1;
		return [c[0] / length, c[1] / length, c[2] / length];
	}

	private corner(t: Tri, vertex: number): number {
		return t.v[0] === vertex ? 0 : t.v[1] === vertex ? 1 : 2;
	}

	private uvAt(t: Tri, vertex: number): Vec2 {
		return t.uv[this.corner(t, vertex)];
	}

	private edgeTris(a: number, b: number): number[] {
		const result: number[] = [];
		for (const id of this.vertTris[a]) if (this.tris[id].v.includes(b)) result.push(id);
		return result;
	}

	private neighbours(vertex: number): Set<number> {
		const result: Set<number> = new Set();
		for (const id of this.vertTris[vertex]) for (const v of this.tris[id].v) if (v !== vertex) result.add(v);
		return result;
	}

	// ---- topology classification -----------------------------------------------------------

	private edgeKind(a: number, b: number): EdgeKind {
		const ids: number[] = this.edgeTris(a, b);
		if (ids.length === 0) return 'missing';
		if (ids.length === 1) return 'border';
		if (ids.length > 2) return 'nonmanifold';
		const t1: Tri = this.tris[ids[0]];
		const t2: Tri = this.tris[ids[1]];
		if (t1.material !== t2.material) return 'seam';
		if (!uvEqual(this.uvAt(t1, a), this.uvAt(t2, a)) || !uvEqual(this.uvAt(t1, b), this.uvAt(t2, b))) return 'seam';
		return 'interior';
	}

	private hasBorder(vertex: number): boolean {
		for (const n of this.neighbours(vertex)) if (this.edgeTris(vertex, n).length === 1) return true;
		return false;
	}

	/** Neighbours joined to `vertex` by a border or seam edge, or null when it touches a non-manifold edge. */
	private constraintNeighbours(vertex: number): number[] | null {
		const constraints: number[] = [];
		for (const n of this.neighbours(vertex)) {
			const kind: EdgeKind = this.edgeKind(vertex, n);
			if (kind === 'nonmanifold') return null;
			if (kind === 'border' || kind === 'seam') constraints.push(n);
		}
		return constraints;
	}

	// ---- quadrics --------------------------------------------------------------------------

	private computeUvScale(): void {
		let world: number = 0;
		let uv: number = 0;
		for (const t of this.tris) {
			for (let i: number = 0; i < 3; i++) {
				const j: number = (i + 1) % 3;
				world += norm(sub(this.positions[t.v[i]], this.positions[t.v[j]]));
				uv += Math.hypot(t.uv[i][0] - t.uv[j][0], t.uv[i][1] - t.uv[j][1]);
			}
		}
		this.uvToWorld = uv > 1e-9 ? world / uv : 1;
	}

	private buildQuadrics(): void {
		for (const q of this.quadrics) q.fill(0);
		this.tris.forEach((t: Tri): void => {
			if (!t.alive) return;
			const n: Vec3 = this.normal(t.v);
			const d: number = -dot(n, this.positions[t.v[0]]);
			for (const v of t.v) addPlane(this.quadrics[v], n, d, 1);
			for (let i: number = 0; i < 3; i++) {
				const a: number = t.v[i];
				const b: number = t.v[(i + 1) % 3];
				const kind: EdgeKind = this.edgeKind(a, b);
				if (kind === 'interior') continue;
				const e: Vec3 = sub(this.positions[b], this.positions[a]);
				const length: number = norm(e);
				const plane: Vec3 = cross(e, n);
				const pl: number = norm(plane) || 1;
				const pn: Vec3 = [plane[0] / pl, plane[1] / pl, plane[2] / pl];
				const pd: number = -dot(pn, this.positions[a]);
				const weight: number = (kind === 'border' ? this.options.borderWeight : this.options.seamWeight) * Math.max(length, 1e-3);
				addPlane(this.quadrics[a], pn, pd, weight);
				addPlane(this.quadrics[b], pn, pd, weight);
			}
		});
	}

	// ---- collapse evaluation ---------------------------------------------------------------

	/** Triangles around `from` grouped into UV-continuous arcs (split at border and seam edges). */
	private arcs(from: number): Map<number, number> {
		const ids: number[] = [...this.vertTris[from]];
		const parent: Map<number, number> = new Map(ids.map((id: number): [number, number] => [id, id]));
		const find = (x: number): number => {
			let r: number = x;
			while (parent.get(r) !== r) r = parent.get(r) as number;
			parent.set(x, r);
			return r;
		};
		for (const id of ids) {
			for (const other of this.tris[id].v) {
				if (other === from || this.edgeKind(from, other) !== 'interior') continue;
				for (const sibling of this.edgeTris(from, other)) if (sibling !== id) parent.set(find(id), find(sibling));
			}
		}
		const result: Map<number, number> = new Map();
		for (const id of ids) result.set(id, find(id));
		return result;
	}

	private reject(reason: string): number {
		this.rejections.set(reason, (this.rejections.get(reason) ?? 0) + 1);
		return Infinity;
	}

	/**
	 * Cost of sliding `from` onto `to`, or Infinity when the move is illegal. When `apply` is
	 * given, the new UV of every surviving triangle corner is written into it.
	 */
	private evaluate(from: number, to: number, apply?: Map<number, Vec2>): number {
		const edge: number[] = this.edgeTris(from, to);
		if (edge.length === 0 || edge.length > 2) return this.reject('edge-nonmanifold');
		const fromConstraints: number[] | null = this.constraintNeighbours(from);
		if (!fromConstraints) return this.reject('nonmanifold');
		// Never bridge two open-border vertices with an interior edge: that pinches the mesh shut.
		if (this.edgeKind(from, to) !== 'border' && this.hasBorder(from) && this.hasBorder(to)) return this.reject('pinch');
		// Link condition: shared neighbours must be exactly the apexes of the removed triangles.
		const apexes: Set<number> = new Set();
		for (const id of edge) for (const v of this.tris[id].v) if (v !== from && v !== to) apexes.add(v);
		const nTo: Set<number> = this.neighbours(to);
		for (const n of this.neighbours(from)) if (nTo.has(n) && !apexes.has(n)) return this.reject('link');

		const arcOf: Map<number, number> = this.arcs(from);
		const target: Vec3 = this.positions[to];
		// One UV per arc: copied from the removed triangle that borders the arc, otherwise the
		// area-weighted extrapolation of the arc's own mapping to the target position.
		const arcUv: Map<number, Vec2> = new Map();
		const arcTris: Map<number, number[]> = new Map();
		for (const [id, arc] of arcOf) {
			if (this.tris[id].v.includes(to)) continue;
			const list: number[] = arcTris.get(arc) ?? [];
			list.push(id);
			arcTris.set(arc, list);
		}
		for (const [arc, ids] of arcTris) {
			const neighbour: number | undefined = edge.find((e: number): boolean => arcOf.get(e) === arc);
			if (neighbour !== undefined) {
				arcUv.set(arc, this.uvAt(this.tris[neighbour], to));
				continue;
			}
			let sumU: number = 0;
			let sumV: number = 0;
			let weight: number = 0;
			for (const id of ids) {
				const guess: Vec2 = this.extrapolateUv(this.tris[id], target);
				const w: number = this.area(this.tris[id].v);
				sumU += guess[0] * w;
				sumV += guess[1] * w;
				weight += w;
			}
			arcUv.set(arc, [sumU / weight, sumV / weight]);
		}
		let uvError: number = 0;
		for (const [arc, ids] of arcTris) {
			const newUv: Vec2 = arcUv.get(arc) as Vec2;
			for (const id of ids) {
				const t: Tri = this.tris[id];
				const index: number = this.corner(t, from);
				const before: Vec3[] = [this.positions[t.v[0]], this.positions[t.v[1]], this.positions[t.v[2]]];
				const after: Vec3[] = before.map((p: Vec3, i: number): Vec3 => (i === index ? target : p));
				const nb: Vec3 = cross(sub(before[1], before[0]), sub(before[2], before[0]));
				const na: Vec3 = cross(sub(after[1], after[0]), sub(after[2], after[0]));
				const lb: number = norm(nb);
				const la: number = norm(na);
				if (la < 1e-10 || la < lb * 0.02) return this.reject('degenerate');
				if (dot(nb, na) / (lb * la) < FLIP_LIMIT) return this.reject('flip');
				const newUvs: [Vec2, Vec2, Vec2] = [t.uv[0], t.uv[1], t.uv[2]];
				newUvs[index] = newUv;
				const ob: number = uvArea2(t.uv[0], t.uv[1], t.uv[2]);
				const oa: number = uvArea2(newUvs[0], newUvs[1], newUvs[2]);
				if (Math.abs(ob) > 1e-12 && ob * oa <= 0) return this.reject('uv-flip');
				const expected: Vec2 = this.extrapolateUv(t, target);
				uvError = Math.max(uvError, Math.hypot(expected[0] - newUv[0], expected[1] - newUv[1]) * this.uvToWorld);
				if (apply) apply.set(id, newUv);
			}
		}
		const geometric: number = evalQuadric(this.quadrics[from], target) + evalQuadric(this.quadrics[to], target);
		return Math.max(0, geometric) + (this.options.uvWeight * uvError) ** 2;
	}

	private extrapolateUv(t: Tri, p: Vec3): Vec2 {
		const a: Vec3 = this.positions[t.v[0]];
		const e1: Vec3 = sub(this.positions[t.v[1]], a);
		const e2: Vec3 = sub(this.positions[t.v[2]], a);
		const d: Vec3 = sub(p, a);
		const d11: number = dot(e1, e1);
		const d12: number = dot(e1, e2);
		const d22: number = dot(e2, e2);
		const p1: number = dot(d, e1);
		const p2: number = dot(d, e2);
		const det: number = d11 * d22 - d12 * d12 || 1e-12;
		const s: number = (p1 * d22 - p2 * d12) / det;
		const u: number = (p2 * d11 - p1 * d12) / det;
		return [t.uv[0][0] + s * (t.uv[1][0] - t.uv[0][0]) + u * (t.uv[2][0] - t.uv[0][0]), t.uv[0][1] + s * (t.uv[1][1] - t.uv[0][1]) + u * (t.uv[2][1] - t.uv[0][1])];
	}

	// ---- execution -------------------------------------------------------------------------

	private push(heap: MinHeap, a: number, b: number): void {
		for (const [from, to] of [[a, b], [b, a]] as Array<[number, number]>) {
			const cost: number = this.evaluate(from, to);
			if (Number.isFinite(cost)) heap.push({ cost, from, to, stampFrom: this.stamp[from], stampTo: this.stamp[to] });
		}
	}

	private collapse(from: number, to: number): void {
		const uvs: Map<number, Vec2> = new Map();
		this.evaluate(from, to, uvs);
		const removed: number[] = this.edgeTris(from, to);
		for (const id of removed) {
			const t: Tri = this.tris[id];
			t.alive = false;
			for (const v of t.v) this.vertTris[v].delete(id);
			this.liveTriangles--;
		}
		for (const id of [...this.vertTris[from]]) {
			const t: Tri = this.tris[id];
			const index: number = this.corner(t, from);
			t.v[index] = to;
			t.uv[index] = uvs.get(id) as Vec2;
			this.vertTris[to].add(id);
		}
		this.vertTris[from].clear();
		for (let i: number = 0; i < 10; i++) this.quadrics[to][i] += this.quadrics[from][i];
		this.stamp[from]++;
		this.stamp[to]++;
		this.collapses++;
	}

	/** Deletes disconnected pieces whose bounding box is smaller than the threshold. */
	private dropSmallComponents(minSize: number): number {
		if (minSize <= 0) return 0;
		const seen: Set<number> = new Set();
		let dropped: number = 0;
		for (let start: number = 0; start < this.tris.length; start++) {
			if (!this.tris[start].alive || seen.has(start)) continue;
			const stack: number[] = [start];
			const members: number[] = [];
			seen.add(start);
			const min: Vec3 = [Infinity, Infinity, Infinity];
			const max: Vec3 = [-Infinity, -Infinity, -Infinity];
			while (stack.length > 0) {
				const id: number = stack.pop() as number;
				members.push(id);
				for (const v of this.tris[id].v) {
					for (let k: number = 0; k < 3; k++) {
						min[k] = Math.min(min[k], this.positions[v][k]);
						max[k] = Math.max(max[k], this.positions[v][k]);
					}
					for (const other of this.vertTris[v]) {
						if (!seen.has(other)) {
							seen.add(other);
							stack.push(other);
						}
					}
				}
			}
			if (norm(sub(max, min)) < minSize) {
				for (const id of members) {
					this.tris[id].alive = false;
					for (const v of this.tris[id].v) this.vertTris[v].delete(id);
					this.liveTriangles--;
				}
				dropped++;
			}
		}
		return dropped;
	}

	run(): OptimizeReport {
		const trianglesBefore: number = this.liveTriangles;
		const verticesBefore: number = this.positions.length;
		const droppedComponents: number = this.dropSmallComponents(this.options.dropComponentSize);
		this.computeUvScale();
		this.buildQuadrics();
		const heap: MinHeap = new MinHeap();
		const edges: Set<string> = new Set();
		this.tris.forEach((t: Tri): void => {
			if (!t.alive) return;
			for (let i: number = 0; i < 3; i++) {
				const a: number = t.v[i];
				const b: number = t.v[(i + 1) % 3];
				const key: string = a < b ? `${a}|${b}` : `${b}|${a}`;
				if (!edges.has(key)) {
					edges.add(key);
					this.push(heap, a, b);
				}
			}
		});
		const soft: number = this.options.maxError ** 2;
		const hard: number = Math.max(this.options.hardMaxError, this.options.maxError) ** 2;
		for (;;) {
			const entry: QueueEntry | undefined = heap.pop();
			if (!entry) break;
			if (entry.stampFrom !== this.stamp[entry.from] || entry.stampTo !== this.stamp[entry.to]) continue;
			const wantsMore: boolean = this.options.targetTriangles > 0 && this.liveTriangles > this.options.targetTriangles;
			if (entry.cost > soft && (!wantsMore || entry.cost > hard)) break;
			const cost: number = this.evaluate(entry.from, entry.to);
			if (!Number.isFinite(cost)) continue;
			if (cost > entry.cost * 1.0001 + 1e-12) {
				heap.push({ ...entry, cost, stampFrom: this.stamp[entry.from], stampTo: this.stamp[entry.to] });
				continue;
			}
			this.finalError = Math.max(this.finalError, Math.sqrt(Math.max(cost, 0)));
			const affected: Set<number> = this.neighbours(entry.from);
			this.collapse(entry.from, entry.to);
			affected.delete(entry.from);
			for (const n of this.neighbours(entry.to)) affected.add(n);
			affected.add(entry.to);
			for (const n of affected) this.stamp[n]++;
			for (const n of affected) {
				if (!this.vertTris[n].size) continue;
				for (const m of this.neighbours(n)) if (m > n || !affected.has(m)) this.push(heap, n, m);
			}
		}
		return {
			trianglesBefore,
			trianglesAfter: this.liveTriangles,
			verticesBefore,
			verticesAfter: 0,
			collapses: this.collapses,
			droppedComponents,
			finalError: this.finalError,
		};
	}

	probeAll(): void {
		for (const t of this.tris) {
			if (!t.alive) continue;
			for (let i: number = 0; i < 3; i++) {
				const a: number = t.v[i];
				const b: number = t.v[(i + 1) % 3];
				if (a < b) {
					this.evaluate(a, b);
					this.evaluate(b, a);
				}
			}
		}
	}

	/** Compacts the surviving triangles back into a prop mesh. */
	toMesh(): PropMesh {
		const remap: Map<number, number> = new Map();
		const positions: Vec3[] = [];
		const faces: PropFace[] = [];
		for (const t of this.tris) {
			if (!t.alive) continue;
			const indices: number[] = t.v.map((v: number): number => {
				let index: number | undefined = remap.get(v);
				if (index === undefined) {
					index = positions.length;
					positions.push([this.positions[v][0], this.positions[v][1], this.positions[v][2]]);
					remap.set(v, index);
				}
				return index;
			});
			faces.push({ indices, uvs: t.uv.map((u: Vec2): Vec2 => [u[0], u[1]]), material: this.materials[t.material] });
		}
		return { positions, faces };
	}
}

/** Splits a polygon into triangle corner triples, cutting quads along their shorter diagonal. */
function triangulateFace(face: PropFace, positions: Vec3[]): Array<[number, number, number]> {
	const n: number = face.indices.length;
	if (n === 3) return [[0, 1, 2]];
	if (n === 4) {
		const p: Vec3[] = face.indices.map((i: number): Vec3 => positions[i]);
		const d02: number = norm(sub(p[0], p[2]));
		const d13: number = norm(sub(p[1], p[3]));
		return d02 <= d13
			? [[0, 1, 2], [0, 2, 3]]
			: [[0, 1, 3], [1, 2, 3]];
	}
	const result: Array<[number, number, number]> = [];
	for (let i: number = 1; i < n - 1; i++) result.push([0, i, i + 1]);
	return result;
}

/** Re-joins coplanar, UV-continuous triangle pairs into quads. Triangle count is unchanged. */
export function quadify(mesh: PropMesh): PropMesh {
	const tris: PropFace[] = mesh.faces;
	const used: boolean[] = tris.map((): boolean => false);
	const edgeMap: Map<string, number[]> = new Map();
	tris.forEach((f: PropFace, id: number): void => {
		if (f.indices.length !== 3) return;
		for (let i: number = 0; i < 3; i++) {
			const a: number = f.indices[i];
			const b: number = f.indices[(i + 1) % 3];
			const key: string = a < b ? `${a}|${b}` : `${b}|${a}`;
			const list: number[] = edgeMap.get(key) ?? [];
			list.push(id);
			edgeMap.set(key, list);
		}
	});
	const normalOf = (f: PropFace): Vec3 => {
		const a: Vec3 = mesh.positions[f.indices[0]];
		const c: Vec3 = cross(sub(mesh.positions[f.indices[1]], a), sub(mesh.positions[f.indices[2]], a));
		const length: number = norm(c) || 1;
		return [c[0] / length, c[1] / length, c[2] / length];
	};
	interface Candidate {
		a: number;
		b: number;
		score: number;
		quad: PropFace;
	}
	const candidates: Candidate[] = [];
	for (const [, ids] of edgeMap) {
		if (ids.length !== 2) continue;
		const [a, b]: number[] = ids;
		const f1: PropFace = tris[a];
		const f2: PropFace = tris[b];
		if (f1.material !== f2.material) continue;
		if (dot(normalOf(f1), normalOf(f2)) < 0.9995) continue;
		// Shared edge as seen by f1 (x -> y) and the apex of each triangle.
		let shared: [number, number] = [-1, -1];
		let apex1: number = -1;
		for (let i: number = 0; i < 3; i++) {
			const x: number = f1.indices[i];
			const y: number = f1.indices[(i + 1) % 3];
			const z: number = f1.indices[(i + 2) % 3];
			if (f2.indices.includes(x) && f2.indices.includes(y)) {
				shared = [x, y];
				apex1 = z;
			}
		}
		if (apex1 < 0) continue;
		const apex2: number = f2.indices.find((v: number): boolean => v !== shared[0] && v !== shared[1]) as number;
		const uvOf = (f: PropFace, v: number): Vec2 => f.uvs[f.indices.indexOf(v)];
		if (!uvEqual(uvOf(f1, shared[0]), uvOf(f2, shared[0])) || !uvEqual(uvOf(f1, shared[1]), uvOf(f2, shared[1]))) continue;
		// Polygon [y, apex1, x, apex2] is counter-clockwise when f1 is x -> y -> apex1.
		const order: number[] = [shared[1], apex1, shared[0], apex2];
		const corners: Vec3[] = order.map((v: number): Vec3 => mesh.positions[v]);
		const n: Vec3 = normalOf(f1);
		let convex: boolean = true;
		let worst: number = 0;
		for (let i: number = 0; i < 4; i++) {
			const p0: Vec3 = corners[i];
			const p1: Vec3 = corners[(i + 1) % 4];
			const p2: Vec3 = corners[(i + 2) % 4];
			const e1: Vec3 = sub(p1, p0);
			const e2: Vec3 = sub(p2, p1);
			if (dot(cross(e1, e2), n) <= 1e-12) convex = false;
			const cosine: number = Math.abs(dot(e1, e2)) / ((norm(e1) * norm(e2)) || 1);
			worst = Math.max(worst, cosine);
		}
		if (!convex) continue;
		const quadUvs: Vec2[] = order.map((v: number): Vec2 => (f1.indices.includes(v) ? uvOf(f1, v) : uvOf(f2, v)));
		if (uvArea2(quadUvs[0], quadUvs[1], quadUvs[2]) * uvArea2(quadUvs[0], quadUvs[2], quadUvs[3]) < 0) continue;
		candidates.push({ a, b, score: worst, quad: { indices: order, uvs: quadUvs, material: f1.material } });
	}
	candidates.sort((x: Candidate, y: Candidate): number => x.score - y.score);
	const output: PropFace[] = [];
	for (const c of candidates) {
		if (used[c.a] || used[c.b]) continue;
		used[c.a] = used[c.b] = true;
		output.push(c.quad);
	}
	tris.forEach((f: PropFace, id: number): void => {
		if (!used[id]) output.push(f);
	});
	return { positions: mesh.positions, faces: output };
}

/** Debug helper: why do the remaining edges refuse to collapse? */
export function diagnoseMesh(mesh: PropMesh, partial: Partial<OptimizeOptions> = {}): Record<string, number> {
	const options: OptimizeOptions = { ...DEFAULT_OPTIMIZE, ...partial };
	const simplifier: Simplifier = new Simplifier(mesh, options);
	simplifier.run();
	simplifier.rejections.clear();
	simplifier.probeAll();
	return Object.fromEntries(simplifier.rejections);
}

export function optimizeMesh(mesh: PropMesh, partial: Partial<OptimizeOptions> = {}): { mesh: PropMesh; report: OptimizeReport } {
	const options: OptimizeOptions = { ...DEFAULT_OPTIMIZE, ...partial };
	const simplifier: Simplifier = new Simplifier(mesh, options);
	const report: OptimizeReport = simplifier.run();
	const result: PropMesh = quadify(simplifier.toMesh());
	report.verticesAfter = result.positions.length;
	return { mesh: result, report };
}
