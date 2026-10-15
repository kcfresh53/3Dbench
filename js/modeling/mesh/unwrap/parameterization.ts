import { ChartMesh } from './chart_mesh';
import { MeshGraph } from './mesh_graph';
import { SparseRowBuilder, SparseRows, solveLeastSquaresCG, solveSymmetricCG } from './linear_solver';
import { Vec3 } from './types';

/** Per-triangle isometric 2D frame: [x1, y1, x2, y2, x3, y3] with p1 at the origin and p2 on the x axis */
export type TriangleFrames = Float64Array;

export function computeTriangleFrames(chart: ChartMesh): TriangleFrames {
	const tri_count: number = chart.triangles.length / 3;
	const frames: Float64Array = new Float64Array(tri_count * 6);
	for (let t: number = 0; t < tri_count; t++) {
		const p1: Vec3 = chart.positions[chart.triangles[t * 3]];
		const p2: Vec3 = chart.positions[chart.triangles[t * 3 + 1]];
		const p3: Vec3 = chart.positions[chart.triangles[t * 3 + 2]];
		const e12: Vec3 = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
		const e13: Vec3 = [p3[0] - p1[0], p3[1] - p1[1], p3[2] - p1[2]];
		const len12: number = Math.hypot(e12[0], e12[1], e12[2]);
		if (len12 < 1e-12) continue;
		const ux: number = e12[0] / len12;
		const uy: number = e12[1] / len12;
		const uz: number = e12[2] / len12;
		const x3: number = e13[0] * ux + e13[1] * uy + e13[2] * uz;
		const cx: number = e13[1] * uz - e13[2] * uy;
		const cy: number = e13[2] * ux - e13[0] * uz;
		const cz: number = e13[0] * uy - e13[1] * ux;
		const y3: number = Math.hypot(cx, cy, cz); // |e13 x u| = height over e12
		frames.set([0, 0, len12, 0, x3, y3], t * 6);
	}
	return frames;
}

export interface PlanarProjection {
	uv: Float64Array
	normal: Vec3
	/** True when all faces of the chart face (almost) the same direction */
	planar: boolean
}

const PLANAR_COS: number = Math.cos(0.5 * Math.PI / 180);

/** Orthogonal projection onto the average plane of the chart, in math orientation (right, up). */
export function projectChartPlanar(graph: MeshGraph, chart: ChartMesh): PlanarProjection {
	let nx: number = 0;
	let ny: number = 0;
	let nz: number = 0;
	for (const f of chart.faces) {
		const face = graph.faces[f];
		nx += face.normal[0] * face.area;
		ny += face.normal[1] * face.area;
		nz += face.normal[2] * face.area;
	}
	let length: number = Math.hypot(nx, ny, nz);
	if (length < 1e-12) {
		nx = 0; ny = 1; nz = 0; length = 1;
	}
	const normal: Vec3 = [nx / length, ny / length, nz / length];
	let planar: boolean = true;
	for (const f of chart.faces) {
		const n: Vec3 = graph.faces[f].normal;
		if (n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] < PLANAR_COS) {
			planar = false;
			break;
		}
	}

	// up vector: world Y, unless looking along it
	let up: Vec3 = Math.abs(normal[1]) > 0.95 ? [0, 0, -1] : [0, 1, 0];
	// right = up x normal, so that the projection is not mirrored when looking at the front of the chart
	let rx: number = up[1] * normal[2] - up[2] * normal[1];
	let ry: number = up[2] * normal[0] - up[0] * normal[2];
	let rz: number = up[0] * normal[1] - up[1] * normal[0];
	const rl: number = Math.hypot(rx, ry, rz);
	rx /= rl; ry /= rl; rz /= rl;
	// true up = normal x right
	const ux: number = normal[1] * rz - normal[2] * ry;
	const uy: number = normal[2] * rx - normal[0] * rz;
	const uz: number = normal[0] * ry - normal[1] * rx;

	const uv: Float64Array = new Float64Array(chart.vertex_count * 2);
	for (let i: number = 0; i < chart.vertex_count; i++) {
		const p: Vec3 = chart.positions[i];
		uv[i * 2] = p[0] * rx + p[1] * ry + p[2] * rz;
		uv[i * 2 + 1] = p[0] * ux + p[1] * uy + p[2] * uz;
	}
	return { uv, normal, planar };
}

/** Picks the two boundary vertices that are farthest apart in the initial projection. */
export function pickPinVertices(chart: ChartMesh, uv: Float64Array): [number, number] {
	const candidates: number[] = [];
	const seen: Set<number> = new Set();
	for (const [a, b] of chart.boundary) {
		if (!seen.has(a)) { seen.add(a); candidates.push(a); }
		if (!seen.has(b)) { seen.add(b); candidates.push(b); }
	}
	if (candidates.length < 2) {
		return [0, Math.min(1, chart.vertex_count - 1)];
	}
	const farthest = (from: number): number => {
		let best: number = candidates[0];
		let best_d: number = -1;
		for (const c of candidates) {
			const d: number = Math.hypot(uv[c * 2] - uv[from * 2], uv[c * 2 + 1] - uv[from * 2 + 1]);
			if (d > best_d) { best_d = d; best = c; }
		}
		return best;
	};
	const a: number = farthest(candidates[0]);
	const b: number = farthest(a);
	return [a, b];
}

/**
 * Least Squares Conformal Maps (Levy et al. 2002) with two pinned vertices.
 * The initial projection provides the pin locations and the start vector for the iterative solver.
 */
export function solveLSCM(chart: ChartMesh, frames: TriangleFrames, initial: Float64Array, pins: [number, number]): Float64Array {
	const n: number = chart.vertex_count;
	const result: Float64Array = Float64Array.from(initial);
	if (n < 3 || pins[0] == pins[1]) return result;

	// free variable numbering: u then v for every non-pinned vertex
	const free_index: Int32Array = new Int32Array(n).fill(-1);
	let free_count: number = 0;
	for (let i: number = 0; i < n; i++) {
		if (i != pins[0] && i != pins[1]) free_index[i] = free_count++;
	}
	const u_var = (vertex: number): number => free_index[vertex];
	const v_var = (vertex: number): number => free_count + free_index[vertex];

	const builder: SparseRowBuilder = new SparseRowBuilder();
	const rhs: number[] = [];
	const tri_count: number = chart.triangles.length / 3;
	for (let t: number = 0; t < tri_count; t++) {
		const x1: number = frames[t * 6], y1: number = frames[t * 6 + 1];
		const x2: number = frames[t * 6 + 2], y2: number = frames[t * 6 + 3];
		const x3: number = frames[t * 6 + 4], y3: number = frames[t * 6 + 5];
		const dT: number = x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2);
		if (dT < 1e-12) continue;
		const scale: number = 1 / Math.sqrt(dT);
		const wr: number[] = [(x3 - x2) * scale, (x1 - x3) * scale, (x2 - x1) * scale];
		const wi: number[] = [(y3 - y2) * scale, (y1 - y3) * scale, (y2 - y1) * scale];
		const ids: number[] = [chart.triangles[t * 3], chart.triangles[t * 3 + 1], chart.triangles[t * 3 + 2]];

		// real part: sum(wr*u - wi*v) = 0, imaginary part: sum(wi*u + wr*v) = 0
		for (let part: number = 0; part < 2; part++) {
			const cols: number[] = [];
			const vals: number[] = [];
			let constant: number = 0;
			for (let j: number = 0; j < 3; j++) {
				const cu: number = part == 0 ? wr[j] : wi[j];
				const cv: number = part == 0 ? -wi[j] : wr[j];
				const id: number = ids[j];
				if (free_index[id] >= 0) {
					cols.push(u_var(id), v_var(id));
					vals.push(cu, cv);
				} else {
					constant += cu * result[id * 2] + cv * result[id * 2 + 1];
				}
			}
			if (!cols.length) continue;
			builder.addRow(cols, vals);
			rhs.push(-constant);
		}
	}
	if (builder.rowCount == 0) return result;
	const A: SparseRows = builder.build(free_count * 2);
	const b: Float64Array = Float64Array.from(rhs);
	const x: Float64Array = new Float64Array(free_count * 2);
	for (let i: number = 0; i < n; i++) {
		if (free_index[i] >= 0) {
			x[u_var(i)] = initial[i * 2];
			x[v_var(i)] = initial[i * 2 + 1];
		}
	}
	solveLeastSquaresCG(A, b, x, Math.min(3000, 20 * n + 100), 1e-9);
	for (let i: number = 0; i < n; i++) {
		if (free_index[i] >= 0) {
			result[i * 2] = x[u_var(i)];
			result[i * 2 + 1] = x[v_var(i)];
		}
	}
	return result;
}

/**
 * As-Rigid-As-Possible refinement (Liu et al. 2008, local/global). Starting from a conformal solution this
 * reduces area distortion while keeping the mapping close to isometric.
 */
export function refineARAP(chart: ChartMesh, frames: TriangleFrames, uv: Float64Array, pin: number, iterations: number): void {
	const n: number = chart.vertex_count;
	const tri_count: number = chart.triangles.length / 3;
	if (iterations <= 0 || tri_count < 2) return;

	// cotangent weights per triangle edge: edge k is opposite of corner k
	const weights: Float64Array = new Float64Array(tri_count * 3);
	const diag: Float64Array = new Float64Array(n);
	const valid: Uint8Array = new Uint8Array(tri_count);
	for (let t: number = 0; t < tri_count; t++) {
		const x: number[] = [frames[t * 6], frames[t * 6 + 2], frames[t * 6 + 4]];
		const y: number[] = [frames[t * 6 + 1], frames[t * 6 + 3], frames[t * 6 + 5]];
		const cross: number = (x[1] - x[0]) * (y[2] - y[0]) - (x[2] - x[0]) * (y[1] - y[0]);
		if (cross < 1e-12) continue;
		valid[t] = 1;
		for (let k: number = 0; k < 3; k++) {
			const a: number = (k + 1) % 3;
			const b: number = (k + 2) % 3;
			const dot: number = (x[a] - x[k]) * (x[b] - x[k]) + (y[a] - y[k]) * (y[b] - y[k]);
			const w: number = Math.max(1e-3, dot / cross / 2);
			weights[t * 3 + k] = w;
			diag[chart.triangles[t * 3 + a]] += w;
			diag[chart.triangles[t * 3 + b]] += w;
		}
	}
	for (let i: number = 0; i < n; i++) if (diag[i] < 1e-12) diag[i] = 1;

	const applyFull = (x: Float64Array, out: Float64Array): void => {
		out.fill(0);
		for (let t: number = 0; t < tri_count; t++) {
			if (!valid[t]) continue;
			for (let k: number = 0; k < 3; k++) {
				const a: number = chart.triangles[t * 3 + (k + 1) % 3];
				const b: number = chart.triangles[t * 3 + (k + 2) % 3];
				const w: number = weights[t * 3 + k];
				const d: number = x[a] - x[b];
				out[a] += w * d;
				out[b] -= w * d;
			}
		}
	};
	// operator with the pinned row/column replaced by identity, which keeps it symmetric positive definite
	const apply = (x: Float64Array, out: Float64Array): void => {
		const masked: Float64Array = Float64Array.from(x);
		masked[pin] = 0;
		applyFull(masked, out);
		out[pin] = x[pin];
	};

	const rhs_u: Float64Array = new Float64Array(n);
	const rhs_v: Float64Array = new Float64Array(n);
	const sol_u: Float64Array = new Float64Array(n);
	const sol_v: Float64Array = new Float64Array(n);
	const pin_u: number = uv[pin * 2];
	const pin_v: number = uv[pin * 2 + 1];
	for (let it: number = 0; it < iterations; it++) {
		rhs_u.fill(0);
		rhs_v.fill(0);
		for (let t: number = 0; t < tri_count; t++) {
			if (!valid[t]) continue;
			const ids: number[] = [chart.triangles[t * 3], chart.triangles[t * 3 + 1], chart.triangles[t * 3 + 2]];
			const fx: number[] = [frames[t * 6], frames[t * 6 + 2], frames[t * 6 + 4]];
			const fy: number[] = [frames[t * 6 + 1], frames[t * 6 + 3], frames[t * 6 + 5]];
			// local step: best rotation for covariance M = sum w * du * dx^T
			let m11: number = 0, m12: number = 0, m21: number = 0, m22: number = 0;
			for (let k: number = 0; k < 3; k++) {
				const a: number = (k + 1) % 3;
				const b: number = (k + 2) % 3;
				const w: number = weights[t * 3 + k];
				const dux: number = uv[ids[a] * 2] - uv[ids[b] * 2];
				const duy: number = uv[ids[a] * 2 + 1] - uv[ids[b] * 2 + 1];
				const dxx: number = fx[a] - fx[b];
				const dxy: number = fy[a] - fy[b];
				m11 += w * dux * dxx; m12 += w * dux * dxy;
				m21 += w * duy * dxx; m22 += w * duy * dxy;
			}
			const theta: number = Math.atan2(m21 - m12, m11 + m22);
			const c: number = Math.cos(theta);
			const s: number = Math.sin(theta);
			for (let k: number = 0; k < 3; k++) {
				const a: number = (k + 1) % 3;
				const b: number = (k + 2) % 3;
				const w: number = weights[t * 3 + k];
				const dxx: number = fx[a] - fx[b];
				const dxy: number = fy[a] - fy[b];
				const rx: number = w * (c * dxx - s * dxy);
				const ry: number = w * (s * dxx + c * dxy);
				rhs_u[ids[a]] += rx; rhs_v[ids[a]] += ry;
				rhs_u[ids[b]] -= rx; rhs_v[ids[b]] -= ry;
			}
		}
		// global step with the pinned vertex moved to the right hand side
		for (const [rhs, sol, pin_value, axis] of [[rhs_u, sol_u, pin_u, 0], [rhs_v, sol_v, pin_v, 1]] as [Float64Array, Float64Array, number, number][]) {
			const pinned: Float64Array = new Float64Array(n);
			pinned[pin] = pin_value;
			const contribution: Float64Array = new Float64Array(n);
			applyFull(pinned, contribution);
			for (let i: number = 0; i < n; i++) {
				if (i != pin) rhs[i] -= contribution[i];
			}
			rhs[pin] = pin_value;
			for (let i: number = 0; i < n; i++) sol[i] = uv[i * 2 + axis];
			solveSymmetricCG(apply, diag, rhs, sol, 300, 1e-7);
		}
		for (let i: number = 0; i < n; i++) {
			uv[i * 2] = sol_u[i];
			uv[i * 2 + 1] = sol_v[i];
		}
	}
}
