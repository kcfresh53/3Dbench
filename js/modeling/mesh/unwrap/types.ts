export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/**
 * smart: seams are placed automatically (angle based) and user seams are respected.
 * seams: only user placed 'divide' seams are used, the rest is cut only where topology requires it.
 */
export type UnwrapMode = 'smart' | 'seams';

export interface UnwrapOptions {
	mode: UnwrapMode
	/** Dihedral angle in degrees above which an edge becomes a seam (smart mode) */
	angle_threshold: number
	/** Maximum accepted area-normalized L2 stretch of a chart (1 = isometric). Charts above this are split. */
	max_stretch: number
	/** Number of ARAP refinement iterations applied after the conformal (LSCM) solve */
	arap_iterations: number
	/** Gap between islands in pixels */
	margin: number
	/** Allow 90 degree rotation of islands while packing */
	allow_rotation: boolean
	/** Rotate islands so that the model's up direction points up in the texture */
	align_up: boolean
	/** Pixels per model unit. 0 = scale all islands to fill the texture. */
	texel_density: number
	uv_width: number
	uv_height: number
}

export const DEFAULT_UNWRAP_OPTIONS: UnwrapOptions = {
	mode: 'smart',
	angle_threshold: 66,
	max_stretch: 1.8,
	arap_iterations: 6,
	margin: 1,
	allow_rotation: true,
	align_up: true,
	texel_density: 0,
	uv_width: 16,
	uv_height: 16,
}

/** An undirected mesh edge, shared by one or more faces. */
export interface GraphEdge {
	id: number
	v0: number
	v1: number
	/** Indices of the faces using this edge. Only edges with exactly two faces can be glued. */
	faces: number[]
	/** Dihedral angle between the two faces in degrees, 0 for non-manifold or border edges */
	angle: number
	seam: MeshSeamValue
}

/** Parameterization of a chart in the (u, v) plane, interleaved [u0, v0, u1, v1, ...] */
export type UVArray = Float64Array;
