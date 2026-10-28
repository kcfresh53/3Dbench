/** Shared plain-data types for the Roadscape core. Nothing here depends on the editor. */
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** A polygon (3 or 4 corners) with one atlas UV per corner, normalised 0..1 with origin top-left. */
export interface PartFace {
	indices: number[];
	uvs: Vec2[];
}

/** A named batch of geometry that shares one atlas. Parts with the same name and atlas are merged. */
export interface MeshPart {
	name: string;
	/** `road` for the bundled Roadscape atlas, otherwise a tree atlas key. */
	atlas: string;
	positions: Vec3[];
	faces: PartFace[];
}

/** A prop face before it is bound to an atlas: material tile name plus tile-local 0..1 UVs. */
export interface PropFace {
	indices: number[];
	uvs: Vec2[];
	material: string;
}

/** Library prop in model space: metres, +Y up, local +X faces the road centre for side props. */
export interface PropMesh {
	positions: Vec3[];
	faces: PropFace[];
}

export function triangleCount(faces: ReadonlyArray<{ indices: number[] }>): number {
	let total: number = 0;
	for (const face of faces) total += face.indices.length - 2;
	return total;
}

/** Structural subset of a tree description, so core code does not depend on the model module. */
export interface TreeSpecLike {
	preset: string;
	height: number;
	variants: number;
	maxTriangles: number;
	seed: number;
}
