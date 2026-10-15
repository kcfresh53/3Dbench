/** Sparse matrix in compressed row storage */
export class SparseRows {
	constructor(
		readonly row_start: Int32Array,
		readonly col: Int32Array,
		readonly val: Float64Array,
		readonly row_count: number,
		readonly col_count: number
	) {}
}

export class SparseRowBuilder {
	private starts: number[] = [0];
	private cols: number[] = [];
	private vals: number[] = [];

	addRow(cols: number[], vals: number[]): void {
		for (let i: number = 0; i < cols.length; i++) {
			this.cols.push(cols[i]);
			this.vals.push(vals[i]);
		}
		this.starts.push(this.cols.length);
	}
	get rowCount(): number {
		return this.starts.length - 1;
	}
	build(col_count: number): SparseRows {
		return new SparseRows(
			Int32Array.from(this.starts),
			Int32Array.from(this.cols),
			Float64Array.from(this.vals),
			this.starts.length - 1,
			col_count
		);
	}
}

export function dot(a: Float64Array, b: Float64Array): number {
	let sum: number = 0;
	for (let i: number = 0; i < a.length; i++) sum += a[i] * b[i];
	return sum;
}

/** out = A x */
export function multiply(A: SparseRows, x: Float64Array, out: Float64Array): void {
	for (let i: number = 0; i < A.row_count; i++) {
		let sum: number = 0;
		for (let k: number = A.row_start[i]; k < A.row_start[i + 1]; k++) sum += A.val[k] * x[A.col[k]];
		out[i] = sum;
	}
}

/** out = A^T y */
export function multiplyTransposed(A: SparseRows, y: Float64Array, out: Float64Array): void {
	out.fill(0);
	for (let i: number = 0; i < A.row_count; i++) {
		const yi: number = y[i];
		if (yi === 0) continue;
		for (let k: number = A.row_start[i]; k < A.row_start[i + 1]; k++) out[A.col[k]] += A.val[k] * yi;
	}
}

/**
 * Jacobi preconditioned conjugate gradient on the normal equations (CGLS): minimizes |A x - b|^2.
 * x holds the initial guess and receives the result. Returns the iteration count.
 */
export function solveLeastSquaresCG(
	A: SparseRows,
	b: Float64Array,
	x: Float64Array,
	max_iterations: number,
	tolerance: number
): number {
	const n: number = A.col_count;
	const m: number = A.row_count;
	const r: Float64Array = new Float64Array(m);
	const q: Float64Array = new Float64Array(m);
	const s: Float64Array = new Float64Array(n);
	const z: Float64Array = new Float64Array(n);
	const p: Float64Array = new Float64Array(n);
	const diag: Float64Array = new Float64Array(n);
	for (let i: number = 0; i < A.val.length; i++) diag[A.col[i]] += A.val[i] * A.val[i];
	for (let i: number = 0; i < n; i++) if (diag[i] < 1e-14) diag[i] = 1;

	multiply(A, x, r);
	for (let i: number = 0; i < m; i++) r[i] = b[i] - r[i];
	multiplyTransposed(A, r, s);
	let gamma: number = 0;
	let s_norm0: number = 0;
	for (let i: number = 0; i < n; i++) {
		z[i] = s[i] / diag[i];
		p[i] = z[i];
		gamma += s[i] * z[i];
		s_norm0 += s[i] * s[i];
	}
	s_norm0 = Math.sqrt(s_norm0);
	if (s_norm0 < 1e-20) return 0;

	let iteration: number = 0;
	while (iteration < max_iterations) {
		iteration++;
		multiply(A, p, q);
		const qq: number = dot(q, q);
		if (qq < 1e-30) break;
		const alpha: number = gamma / qq;
		for (let i: number = 0; i < n; i++) x[i] += alpha * p[i];
		for (let i: number = 0; i < m; i++) r[i] -= alpha * q[i];
		multiplyTransposed(A, r, s);
		let s_norm2: number = 0;
		let gamma_new: number = 0;
		for (let i: number = 0; i < n; i++) {
			z[i] = s[i] / diag[i];
			gamma_new += s[i] * z[i];
			s_norm2 += s[i] * s[i];
		}
		if (Math.sqrt(s_norm2) <= tolerance * s_norm0) break;
		const beta: number = gamma_new / gamma;
		gamma = gamma_new;
		for (let i: number = 0; i < n; i++) p[i] = z[i] + beta * p[i];
	}
	return iteration;
}

/**
 * Jacobi preconditioned conjugate gradient for a symmetric positive definite operator.
 */
export function solveSymmetricCG(
	apply: (x: Float64Array, out: Float64Array) => void,
	diag: Float64Array,
	b: Float64Array,
	x: Float64Array,
	max_iterations: number,
	tolerance: number
): number {
	const n: number = b.length;
	const r: Float64Array = new Float64Array(n);
	const z: Float64Array = new Float64Array(n);
	const p: Float64Array = new Float64Array(n);
	const q: Float64Array = new Float64Array(n);
	apply(x, q);
	let b_norm: number = 0;
	for (let i: number = 0; i < n; i++) {
		r[i] = b[i] - q[i];
		z[i] = r[i] / diag[i];
		p[i] = z[i];
		b_norm += b[i] * b[i];
	}
	b_norm = Math.sqrt(b_norm) + 1e-20;
	let rz: number = dot(r, z);
	let iteration: number = 0;
	while (iteration < max_iterations) {
		if (Math.sqrt(dot(r, r)) <= tolerance * b_norm) break;
		iteration++;
		apply(p, q);
		const pq: number = dot(p, q);
		if (Math.abs(pq) < 1e-30) break;
		const alpha: number = rz / pq;
		for (let i: number = 0; i < n; i++) {
			x[i] += alpha * p[i];
			r[i] -= alpha * q[i];
			z[i] = r[i] / diag[i];
		}
		const rz_new: number = dot(r, z);
		const beta: number = rz_new / rz;
		rz = rz_new;
		for (let i: number = 0; i < n; i++) p[i] = z[i] + beta * p[i];
	}
	return iteration;
}
