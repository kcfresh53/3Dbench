/**
 * Compact bounding volume hierarchy over triangles, used for occlusion and thickness rays.
 * Nodes are stored in flat typed arrays.
 */
export class TriangleBVH {
	private readonly bounds: Float32Array;
	/** For inner nodes: index of the right child (left child is node + 1). For leaves: first index into `order`. */
	private readonly offset: Int32Array;
	/** Leaves have count > 0 */
	private readonly count: Int32Array;
	private readonly order: Int32Array;
	private node_count: number = 0;
	private readonly positions: Float32Array;

	/** @param positions 9 floats per triangle (world space) */
	constructor(positions: Float32Array) {
		this.positions = positions;
		const tri_count: number = positions.length / 9;
		this.order = new Int32Array(tri_count);
		for (let i: number = 0; i < tri_count; i++) this.order[i] = i;
		const max_nodes: number = Math.max(1, tri_count * 2);
		this.bounds = new Float32Array(max_nodes * 6);
		this.offset = new Int32Array(max_nodes);
		this.count = new Int32Array(max_nodes);

		const centroids: Float32Array = new Float32Array(tri_count * 3);
		for (let t: number = 0; t < tri_count; t++) {
			for (let k: number = 0; k < 3; k++) {
				centroids[t * 3 + k] = (positions[t * 9 + k] + positions[t * 9 + 3 + k] + positions[t * 9 + 6 + k]) / 3;
			}
		}
		if (tri_count > 0) this.build(0, tri_count, centroids);
	}

	private build(start: number, end: number, centroids: Float32Array): number {
		const node: number = this.node_count++;
		const b: Float32Array = this.bounds;
		const o: number = node * 6;
		b[o] = b[o + 1] = b[o + 2] = Infinity;
		b[o + 3] = b[o + 4] = b[o + 5] = -Infinity;
		let cmin: Vec3Tuple = [Infinity, Infinity, Infinity];
		let cmax: Vec3Tuple = [-Infinity, -Infinity, -Infinity];
		for (let i: number = start; i < end; i++) {
			const t: number = this.order[i];
			for (let v: number = 0; v < 3; v++) {
				for (let k: number = 0; k < 3; k++) {
					const value: number = this.positions[t * 9 + v * 3 + k];
					if (value < b[o + k]) b[o + k] = value;
					if (value > b[o + 3 + k]) b[o + 3 + k] = value;
				}
			}
			for (let k: number = 0; k < 3; k++) {
				const c: number = centroids[t * 3 + k];
				if (c < cmin[k]) cmin[k] = c;
				if (c > cmax[k]) cmax[k] = c;
			}
		}
		const size: number = end - start;
		if (size <= 4) {
			this.offset[node] = start;
			this.count[node] = size;
			return node;
		}
		let axis: number = 0;
		const ex: number = cmax[0] - cmin[0], ey: number = cmax[1] - cmin[1], ez: number = cmax[2] - cmin[2];
		if (ey > ex && ey >= ez) axis = 1; else if (ez > ex && ez > ey) axis = 2;
		const extent: number = cmax[axis] - cmin[axis];
		if (extent <= 1e-9) {
			this.offset[node] = start;
			this.count[node] = size;
			return node;
		}
		// Partition around the centroid midpoint; fall back to a median split for degenerate partitions
		const mid_value: number = (cmin[axis] + cmax[axis]) / 2;
		let i: number = start, j: number = end - 1;
		while (i <= j) {
			if (centroids[this.order[i] * 3 + axis] < mid_value) {
				i++;
			} else {
				const tmp: number = this.order[i]; this.order[i] = this.order[j]; this.order[j] = tmp;
				j--;
			}
		}
		let split: number = i;
		if (split == start || split == end) split = (start + end) >> 1;
		this.count[node] = 0;
		this.build(start, split, centroids);
		this.offset[node] = this.build(split, end, centroids);
		return node;
	}

	private readonly stack: Int32Array = new Int32Array(128);

	private intersectBox(node: number, ox: number, oy: number, oz: number, ix: number, iy: number, iz: number, t_max: number): boolean {
		const b: Float32Array = this.bounds;
		const o: number = node * 6;
		let t0: number = 0, t1: number = t_max;
		let a: number = (b[o] - ox) * ix, c: number = (b[o + 3] - ox) * ix;
		t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
		a = (b[o + 1] - oy) * iy; c = (b[o + 4] - oy) * iy;
		t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
		a = (b[o + 2] - oz) * iz; c = (b[o + 5] - oz) * iz;
		t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
		return t0 <= t1;
	}

	/** Moeller-Trumbore, double sided. Returns hit distance or -1. */
	private intersectTriangle(t: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, t_max: number): number {
		const p: Float32Array = this.positions;
		const i: number = t * 9;
		const e1x: number = p[i + 3] - p[i], e1y: number = p[i + 4] - p[i + 1], e1z: number = p[i + 5] - p[i + 2];
		const e2x: number = p[i + 6] - p[i], e2y: number = p[i + 7] - p[i + 1], e2z: number = p[i + 8] - p[i + 2];
		const px: number = dy * e2z - dz * e2y, py: number = dz * e2x - dx * e2z, pz: number = dx * e2y - dy * e2x;
		const det: number = e1x * px + e1y * py + e1z * pz;
		if (Math.abs(det) < 1e-12) return -1;
		const inv: number = 1 / det;
		const tx: number = ox - p[i], ty: number = oy - p[i + 1], tz: number = oz - p[i + 2];
		const u: number = (tx * px + ty * py + tz * pz) * inv;
		if (u < 0 || u > 1) return -1;
		const qx: number = ty * e1z - tz * e1y, qy: number = tz * e1x - tx * e1z, qz: number = tx * e1y - ty * e1x;
		const v: number = (dx * qx + dy * qy + dz * qz) * inv;
		if (v < 0 || u + v > 1) return -1;
		const dist: number = (e2x * qx + e2y * qy + e2z * qz) * inv;
		return dist > 0 && dist < t_max ? dist : -1;
	}

	/** Distance to the closest hit along a normalized ray, or -1 when nothing is hit within t_max. */
	closestHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, t_max: number): number {
		if (this.node_count == 0) return -1;
		const ix: number = 1 / (dx || 1e-12), iy: number = 1 / (dy || 1e-12), iz: number = 1 / (dz || 1e-12);
		let best: number = t_max;
		let hit: boolean = false;
		const stack: Int32Array = this.stack;
		let sp: number = 0;
		stack[sp++] = 0;
		while (sp > 0) {
			const node: number = stack[--sp];
			if (!this.intersectBox(node, ox, oy, oz, ix, iy, iz, best)) continue;
			const n: number = this.count[node];
			if (n > 0) {
				const first: number = this.offset[node];
				for (let k: number = first; k < first + n; k++) {
					const d: number = this.intersectTriangle(this.order[k], ox, oy, oz, dx, dy, dz, best);
					if (d >= 0) { best = d; hit = true; }
				}
			} else {
				stack[sp++] = this.offset[node];
				stack[sp++] = node + 1;
			}
		}
		return hit ? best : -1;
	}

	/** True when anything blocks the ray within t_max. Stops at the first hit. */
	isOccluded(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, t_max: number): boolean {
		if (this.node_count == 0) return false;
		const ix: number = 1 / (dx || 1e-12), iy: number = 1 / (dy || 1e-12), iz: number = 1 / (dz || 1e-12);
		const stack: Int32Array = this.stack;
		let sp: number = 0;
		stack[sp++] = 0;
		while (sp > 0) {
			const node: number = stack[--sp];
			if (!this.intersectBox(node, ox, oy, oz, ix, iy, iz, t_max)) continue;
			const n: number = this.count[node];
			if (n > 0) {
				const first: number = this.offset[node];
				for (let k: number = first; k < first + n; k++) {
					if (this.intersectTriangle(this.order[k], ox, oy, oz, dx, dy, dz, t_max) >= 0) return true;
				}
			} else {
				stack[sp++] = this.offset[node];
				stack[sp++] = node + 1;
			}
		}
		return false;
	}
}

type Vec3Tuple = [number, number, number];
