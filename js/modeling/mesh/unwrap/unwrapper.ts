import { MeshGraph } from './mesh_graph';
import { buildChartMesh, analyzeTopology, ChartMesh, ChartTopology } from './chart_mesh';
import { componentsOf, computeBisectionCuts, computeDiskCuts } from './cut_graph';
import {
	computeTriangleFrames, projectChartPlanar, pickPinVertices, solveLSCM, refineARAP,
	PlanarProjection, TriangleFrames,
} from './parameterization';
import { evaluateChart, ChartQuality } from './metrics';
import { minimumAreaRotation } from './orientation';
import { UnwrapOptions, Vec2, Vec3 } from './types';

/** A finished island. Coordinates are in model units (area preserving) in image orientation (v points down). */
export interface UnwrappedChart {
	/** Graph face indices */
	faces: number[]
	/** uv of each polygon corner, aligned with the corners of each face in `faces` */
	corner_uv: Vec2[][]
	/** Triangles as [u0, v0, u1, v1, u2, v2, ...] for packing */
	tris: Float64Array
	surface_area: number
	stretch: number
}

interface ParameterizedChart {
	uv: Float64Array
	quality: ChartQuality
}

/**
 * Turns a mesh graph into UV islands: cuts the surface into charts, flattens every chart with LSCM + ARAP
 * and splits charts that remain too distorted until all of them are acceptable.
 */
export class ChartUnwrapper {
	private readonly cut: Uint8Array;

	constructor(private graph: MeshGraph, private options: UnwrapOptions) {
		this.cut = new Uint8Array(graph.edges.length);
		for (const edge of graph.edges) {
			if (edge.faces.length != 2) continue;
			if (edge.seam == 'divide') {
				this.cut[edge.id] = 1;
			} else if (options.mode == 'smart' && edge.seam != 'join' && edge.angle > options.angle_threshold) {
				this.cut[edge.id] = 1;
			}
		}
	}

	unwrap(): UnwrappedChart[] {
		const graph: MeshGraph = this.graph;
		const result: UnwrappedChart[] = [];
		const all_faces: number[] = graph.faces.map((_, i: number) => i);
		const queue: number[][] = componentsOf(graph, all_faces, this.cut);
		let budget: number = graph.faces.length * 4 + 64;

		while (queue.length) {
			const faces: number[] = queue.pop() as number[];
			const chart: ChartMesh = buildChartMesh(graph, faces, this.cut);
			const can_split: boolean = faces.length > 1 && budget > 0;

			if (can_split) {
				const topology: ChartTopology = analyzeTopology(chart);
				if (!topology.is_disk) {
					budget--;
					const new_cuts: number[] = this.makeDiskCuts(faces, topology);
					if (new_cuts.length) {
						this.applyCuts(new_cuts, faces, queue);
						continue;
					}
				}
			}

			const frames: TriangleFrames = computeTriangleFrames(chart);
			const parameterized: ParameterizedChart = this.parameterize(chart, frames);
			const quality: ChartQuality = parameterized.quality;
			const acceptable: boolean = quality.flipped == 0 && !quality.overlap && quality.stretch <= this.options.max_stretch;
			if (!acceptable && can_split) {
				budget--;
				const new_cuts: number[] = computeBisectionCuts(graph, faces, this.cut);
				if (new_cuts.length) {
					this.applyCuts(new_cuts, faces, queue);
					continue;
				}
			}
			result.push(this.finishChart(chart, frames, parameterized));
		}
		return result;
	}

	private makeDiskCuts(faces: number[], topology: ChartTopology): number[] {
		if (topology.boundary_loops > 0) {
			const cuts: number[] = computeDiskCuts(this.graph, faces, this.cut);
			if (cuts.length) return cuts;
		}
		return computeBisectionCuts(this.graph, faces, this.cut);
	}

	private applyCuts(edge_ids: number[], faces: number[], queue: number[][]): void {
		for (const id of edge_ids) this.cut[id] = 1;
		for (const component of componentsOf(this.graph, faces, this.cut)) queue.push(component);
	}

	private parameterize(chart: ChartMesh, frames: TriangleFrames): ParameterizedChart {
		const projection: PlanarProjection = projectChartPlanar(this.graph, chart);
		let uv: Float64Array = projection.uv;
		if (!projection.planar && chart.faces.length > 1) {
			const pins: [number, number] = pickPinVertices(chart, uv);
			uv = solveLSCM(chart, frames, uv, pins);
			refineARAP(chart, frames, uv, pins[0], this.options.arap_iterations);
		}
		return { uv, quality: evaluateChart(chart, frames, uv, !projection.planar) };
	}

	private finishChart(chart: ChartMesh, frames: TriangleFrames, parameterized: ParameterizedChart): UnwrappedChart {
		const n: number = chart.vertex_count;
		const uv: Float64Array = Float64Array.from(parameterized.uv);
		const { quality } = parameterized;

		// uniform scale so the UV area equals the surface area
		if (quality.uv_area > 1e-12 && quality.surface_area > 1e-12) {
			const k: number = Math.sqrt(quality.surface_area / quality.uv_area);
			for (let i: number = 0; i < uv.length; i++) uv[i] *= k;
		}

		// rotation: minimum area bounding box, then pick the 90 degree step where model-up points up
		const points: Vec2[] = [];
		for (let i: number = 0; i < n; i++) points.push([uv[i * 2], uv[i * 2 + 1]]);
		let angle: number = minimumAreaRotation(points);
		if (this.options.align_up) angle += this.upwardCorrection(chart, uv, angle);
		const c: number = Math.cos(angle);
		const s: number = Math.sin(angle);
		let min_x: number = Infinity;
		let min_y: number = Infinity;
		for (let i: number = 0; i < n; i++) {
			const x: number = uv[i * 2] * c - uv[i * 2 + 1] * s;
			const y: number = uv[i * 2] * s + uv[i * 2 + 1] * c;
			uv[i * 2] = x;
			uv[i * 2 + 1] = y;
			min_x = Math.min(min_x, x);
			min_y = Math.min(min_y, y);
		}
		// math orientation (up) -> image orientation (down)
		for (let i: number = 0; i < n; i++) {
			uv[i * 2] -= min_x;
			uv[i * 2 + 1] = -(uv[i * 2 + 1] - min_y);
		}
		let image_min_y: number = Infinity;
		for (let i: number = 0; i < n; i++) image_min_y = Math.min(image_min_y, uv[i * 2 + 1]);
		for (let i: number = 0; i < n; i++) uv[i * 2 + 1] -= image_min_y;

		const corner_uv: Vec2[][] = chart.corner_vertex.map((ids: number[]) =>
			ids.map((id: number) => [uv[id * 2], uv[id * 2 + 1]] as Vec2)
		);
		const tris: Float64Array = new Float64Array(chart.triangles.length * 2);
		chart.triangles.forEach((id: number, i: number) => {
			tris[i * 2] = uv[id * 2];
			tris[i * 2 + 1] = uv[id * 2 + 1];
		});
		return {
			faces: chart.faces,
			corner_uv,
			tris,
			surface_area: quality.surface_area,
			stretch: quality.stretch,
		};
	}

	/**
	 * Extra rotation (multiple of 90 degrees) after which the average direction of increasing model height
	 * points up in the chart. Zero for charts that are horizontal.
	 */
	private upwardCorrection(chart: ChartMesh, uv: Float64Array, base_angle: number): number {
		let gx: number = 0;
		let gy: number = 0;
		const tri_count: number = chart.triangles.length / 3;
		for (let t: number = 0; t < tri_count; t++) {
			const ids: number[] = [chart.triangles[t * 3], chart.triangles[t * 3 + 1], chart.triangles[t * 3 + 2]];
			const h: number[] = ids.map((id: number) => (chart.positions[id] as Vec3)[1]);
			const s: number[] = ids.map((id: number) => uv[id * 2]);
			const v: number[] = ids.map((id: number) => uv[id * 2 + 1]);
			const det: number = (s[1] - s[0]) * (v[2] - v[0]) - (s[2] - s[0]) * (v[1] - v[0]);
			if (Math.abs(det) < 1e-12) continue;
			// gradient of the height over the uv triangle
			const dh1: number = h[1] - h[0];
			const dh2: number = h[2] - h[0];
			const grad_x: number = (dh1 * (v[2] - v[0]) - dh2 * (v[1] - v[0])) / det;
			const grad_y: number = (dh2 * (s[1] - s[0]) - dh1 * (s[2] - s[0])) / det;
			const weight: number = Math.abs(det);
			gx += grad_x * weight;
			gy += grad_y * weight;
		}
		if (Math.hypot(gx, gy) < 1e-9) return 0;
		const gradient_angle: number = Math.atan2(gy, gx) + base_angle;
		// we want the gradient to point at +90 degrees (up)
		const needed: number = Math.PI / 2 - gradient_angle;
		return Math.round(needed / (Math.PI / 2)) * (Math.PI / 2);
	}
}
