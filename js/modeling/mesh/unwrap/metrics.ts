import { ChartMesh } from './chart_mesh';
import { TriangleFrames } from './parameterization';

export interface ChartQuality {
	/** Triangles with inverted orientation in the parameterization */
	flipped: number
	/** Area-weighted RMS L2 stretch (Sander et al. 2001) after normalizing the UV area to the surface area */
	stretch: number
	/** True when the chart boundary intersects itself */
	overlap: boolean
	/** Sum of the UV triangle areas */
	uv_area: number
	surface_area: number
}

function segmentsCross(
	ax: number, ay: number, bx: number, by: number,
	cx: number, cy: number, dx: number, dy: number
): boolean {
	const d1: number = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
	const d2: number = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
	const d3: number = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
	const d4: number = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
	return ((d1 > 0) != (d2 > 0)) && ((d3 > 0) != (d4 > 0)) && d1 != 0 && d2 != 0 && d3 != 0 && d4 != 0;
}

export function boundaryOverlaps(chart: ChartMesh, uv: Float64Array): boolean {
	const segments = chart.boundary;
	if (segments.length > 3000) return false;
	const count: number = segments.length;
	const min_x: Float64Array = new Float64Array(count);
	const max_x: Float64Array = new Float64Array(count);
	const min_y: Float64Array = new Float64Array(count);
	const max_y: Float64Array = new Float64Array(count);
	segments.forEach(([a, b], i: number) => {
		min_x[i] = Math.min(uv[a * 2], uv[b * 2]);
		max_x[i] = Math.max(uv[a * 2], uv[b * 2]);
		min_y[i] = Math.min(uv[a * 2 + 1], uv[b * 2 + 1]);
		max_y[i] = Math.max(uv[a * 2 + 1], uv[b * 2 + 1]);
	});
	for (let i: number = 0; i < count; i++) {
		const [a, b] = segments[i];
		for (let j: number = i + 1; j < count; j++) {
			const [c, d] = segments[j];
			if (a == c || a == d || b == c || b == d) continue;
			if (max_x[i] < min_x[j] || max_x[j] < min_x[i] || max_y[i] < min_y[j] || max_y[j] < min_y[i]) continue;
			if (segmentsCross(
				uv[a * 2], uv[a * 2 + 1], uv[b * 2], uv[b * 2 + 1],
				uv[c * 2], uv[c * 2 + 1], uv[d * 2], uv[d * 2 + 1]
			)) return true;
		}
	}
	return false;
}

/** Evaluates a parameterization given in math orientation (counter clockwise triangles have positive area). */
export function evaluateChart(chart: ChartMesh, frames: TriangleFrames, uv: Float64Array, check_overlap: boolean = true): ChartQuality {
	const tri_count: number = chart.triangles.length / 3;
	let uv_area: number = 0;
	let surface_area: number = 0;
	let flipped: number = 0;
	const metric_a: Float64Array = new Float64Array(tri_count);
	const area_3d: Float64Array = new Float64Array(tri_count);
	const valid: Uint8Array = new Uint8Array(tri_count);

	for (let t: number = 0; t < tri_count; t++) {
		const x: number[] = [frames[t * 6], frames[t * 6 + 2], frames[t * 6 + 4]];
		const y: number[] = [frames[t * 6 + 1], frames[t * 6 + 3], frames[t * 6 + 5]];
		const a3: number = ((x[1] - x[0]) * (y[2] - y[0]) - (x[2] - x[0]) * (y[1] - y[0])) / 2;
		if (a3 < 1e-12) continue;
		const ids: number[] = [chart.triangles[t * 3], chart.triangles[t * 3 + 1], chart.triangles[t * 3 + 2]];
		const s: number[] = ids.map((id: number) => uv[id * 2]);
		const tt: number[] = ids.map((id: number) => uv[id * 2 + 1]);
		const a_uv: number = ((s[1] - s[0]) * (tt[2] - tt[0]) - (s[2] - s[0]) * (tt[1] - tt[0])) / 2;
		surface_area += a3;
		if (a_uv <= a3 * 1e-6) {
			flipped++;
			continue;
		}
		uv_area += a_uv;
		valid[t] = 1;
		area_3d[t] = a3;
		const inv: number = 1 / (2 * a_uv);
		// partial derivatives of the surface position (in the triangle frame) by u and v
		const ss_x: number = (x[0] * (tt[1] - tt[2]) + x[1] * (tt[2] - tt[0]) + x[2] * (tt[0] - tt[1])) * inv;
		const ss_y: number = (y[0] * (tt[1] - tt[2]) + y[1] * (tt[2] - tt[0]) + y[2] * (tt[0] - tt[1])) * inv;
		const st_x: number = (x[0] * (s[2] - s[1]) + x[1] * (s[0] - s[2]) + x[2] * (s[1] - s[0])) * inv;
		const st_y: number = (y[0] * (s[2] - s[1]) + y[1] * (s[0] - s[2]) + y[2] * (s[1] - s[0])) * inv;
		metric_a[t] = (ss_x * ss_x + ss_y * ss_y + st_x * st_x + st_y * st_y) / 2;
	}

	let stretch: number = 1;
	if (uv_area > 0 && surface_area > 0) {
		const normalization: number = uv_area / surface_area;
		let weighted: number = 0;
		let weight: number = 0;
		for (let t: number = 0; t < tri_count; t++) {
			if (!valid[t]) continue;
			weighted += area_3d[t] * metric_a[t] * normalization;
			weight += area_3d[t];
		}
		stretch = Math.sqrt(weighted / weight);
	} else {
		stretch = Infinity;
	}
	return {
		flipped,
		stretch,
		overlap: check_overlap && flipped == 0 ? boundaryOverlaps(chart, uv) : false,
		uv_area,
		surface_area,
	};
}
