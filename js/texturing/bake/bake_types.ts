import type { PBRChannel } from '../pbr_channels';

export type Vec3 = [number, number, number];

export type BakePassId = 'ao' | 'thickness' | 'curvature' | 'normal' | 'position' | 'id';

export interface BakeOptions {
	pass: BakePassId
	width: number
	height: number
	/** Rays per texel for ray traced passes */
	samples: number
	/** Ray length limit, in model units. 0 = automatic from model size */
	max_distance: number
	/** Pixels of edge padding around UV islands */
	padding: number
	/** Use smoothed vertex normals instead of flat face normals */
	smooth_normals: boolean
	/** Curvature contrast */
	strength: number
	selection_only: boolean
}

export const DEFAULT_BAKE_OPTIONS: BakeOptions = {
	pass: 'ao',
	width: 512,
	height: 512,
	samples: 32,
	max_distance: 0,
	padding: 4,
	smooth_normals: false,
	strength: 1,
	selection_only: false,
};

/** Mutable per-texel record that is reused for every texel to avoid allocations. */
export interface TexelSample {
	tri: number
	/** Barycentric coordinates inside the triangle */
	b0: number
	b1: number
	b2: number
	position: Vec3
	normal: Vec3
	/** Texel index, used as a stable seed for sampling patterns */
	seed: number
}

export interface BakeContext {
	options: BakeOptions
	/** Resolved max ray distance */
	max_distance: number
	/** Bias used to push ray origins off the surface */
	bias: number
}

export interface BakePass {
	id: BakePassId
	/** PBR channel the result is meant for. null for utility maps */
	channel: PBRChannel | null
	/** Color of texels outside of any UV island */
	background: Vec3
	/** Whether the pass shoots rays and therefore needs the acceleration structure */
	needs_rays: boolean
	/** Computes the color of one texel. Output components are 0-1. */
	shade(scene: BakeScene, ctx: BakeContext, sample: TexelSample, out: Vec3): void
}

/** Forward declaration, implemented in bake_scene.ts */
import type { BakeScene } from './bake_scene';
