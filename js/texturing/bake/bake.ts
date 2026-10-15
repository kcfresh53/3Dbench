import { BakeScene, rasterizeUVs, UVRaster } from './bake_scene';
import { BAKE_PASSES } from './bake_passes';
import { dilateRGBA } from './dilate';
import type { BakeContext, BakeOptions, BakePass, TexelSample } from './bake_types';

export interface BakeResult {
	image: ImageData
	pass: BakePass
	texel_count: number
}

function nextFrame(): Promise<void> {
	return new Promise((resolve: () => void) => setTimeout(resolve, 0));
}

/** Meshes taking part in a bake: the selection if requested and available, otherwise all visible meshes. */
export function getBakeMeshes(selection_only: boolean): Mesh[] {
	if (selection_only && Mesh.selected.length) return Mesh.selected.slice();
	return Mesh.all.filter((mesh: Mesh) => mesh.visibility !== false);
}

/**
 * Bakes a map into the UV layout of the given meshes.
 * Runs in time slices so the interface stays responsive and reports progress through `on_progress`.
 */
export async function bakeMap(meshes: Mesh[], options: BakeOptions, on_progress?: (fraction: number) => void): Promise<BakeResult> {
	const pass: BakePass = BAKE_PASSES[options.pass];
	const scene: BakeScene = new BakeScene(meshes, options.smooth_normals, Project.texture_width, Project.texture_height);
	const raster: UVRaster = rasterizeUVs(scene, options.width, options.height);

	const context: BakeContext = {
		options,
		max_distance: options.max_distance > 0 ? options.max_distance : scene.diagonal * 0.25,
		bias: Math.max(scene.diagonal * 1e-4, 1e-5),
	};
	if (pass.needs_rays) scene.bvh;

	const pixel_count: number = options.width * options.height;
	const data: Uint8ClampedArray = new Uint8ClampedArray(pixel_count * 4);
	const covered: Uint8Array = new Uint8Array(pixel_count);
	const sample: TexelSample = {tri: 0, b0: 0, b1: 0, b2: 0, position: [0, 0, 0], normal: [0, 0, 1], seed: 0};
	const color: [number, number, number] = [0, 0, 0];

	let texel_count: number = 0;
	let slice_start: number = performance.now();
	for (let index: number = 0; index < pixel_count; index++) {
		const t: number = raster.tri[index];
		if (t < 0) {
			data[index * 4] = pass.background[0] * 255;
			data[index * 4 + 1] = pass.background[1] * 255;
			data[index * 4 + 2] = pass.background[2] * 255;
			data[index * 4 + 3] = 255;
		} else {
			sample.tri = t;
			sample.b0 = raster.bary[index * 3];
			sample.b1 = raster.bary[index * 3 + 1];
			sample.b2 = raster.bary[index * 3 + 2];
			sample.seed = index + 1;
			const p: number = t * 9;
			for (let k: number = 0; k < 3; k++) {
				sample.position[k] = scene.tri_pos[p + k] * sample.b0 + scene.tri_pos[p + 3 + k] * sample.b1 + scene.tri_pos[p + 6 + k] * sample.b2;
				sample.normal[k] = scene.tri_nrm[p + k] * sample.b0 + scene.tri_nrm[p + 3 + k] * sample.b1 + scene.tri_nrm[p + 6 + k] * sample.b2;
			}
			const length: number = Math.hypot(sample.normal[0], sample.normal[1], sample.normal[2]) || 1;
			sample.normal[0] /= length; sample.normal[1] /= length; sample.normal[2] /= length;

			pass.shade(scene, context, sample, color);
			data[index * 4] = color[0] * 255;
			data[index * 4 + 1] = color[1] * 255;
			data[index * 4 + 2] = color[2] * 255;
			data[index * 4 + 3] = 255;
			covered[index] = 1;
			texel_count++;
		}
		if ((index & 255) == 0 && performance.now() - slice_start > 30) {
			on_progress?.(index / pixel_count);
			await nextFrame();
			slice_start = performance.now();
		}
	}
	if (options.padding > 0) dilateRGBA(data, covered, options.width, options.height, options.padding);
	on_progress?.(1);
	return {image: new ImageData(data, options.width, options.height), pass, texel_count};
}

/** Coverage mask of the UV layout at a given resolution, used by the edge padding tool. */
export function computeUVCoverage(meshes: Mesh[], width: number, height: number): Uint8Array {
	const scene: BakeScene = new BakeScene(meshes, false, Project.texture_width, Project.texture_height);
	const raster: UVRaster = rasterizeUVs(scene, width, height);
	const covered: Uint8Array = new Uint8Array(width * height);
	for (let i: number = 0; i < covered.length; i++) covered[i] = raster.tri[i] >= 0 ? 1 : 0;
	return covered;
}
