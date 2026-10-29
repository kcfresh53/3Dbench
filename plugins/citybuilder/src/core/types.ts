/** Shared plain-data types for the City Builder core. Nothing here depends on the editor. */
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

import type { PartFace as RoadPartFace, PropFace as RoadPropFace } from '../../../roadscape/src/core/types';

export interface PartFace extends RoadPartFace {
	/** Optional explicit corner normals; preserve curved surfaces across UV seams. */
	normals?: Vec3[];
}
export interface PropFace extends RoadPropFace { normals?: Vec3[]; }
export interface PropMesh { positions: Vec3[]; faces: PropFace[]; }
export interface MeshPart { name: string; atlas: string; positions: Vec3[]; faces: PartFace[]; }

/** Inclusive rectangle of grid indices (vertices or cells, depending on the grid). */
export interface GridRect {
	c0: number;
	r0: number;
	c1: number;
	r1: number;
}

export function emptyRect(): GridRect {
	return { c0: Infinity, r0: Infinity, c1: -Infinity, r1: -Infinity };
}

export function isEmptyRect(rect: GridRect): boolean {
	return rect.c1 < rect.c0 || rect.r1 < rect.r0;
}

export function unionRect(a: GridRect, b: GridRect): GridRect {
	return { c0: Math.min(a.c0, b.c0), r0: Math.min(a.r0, b.r0), c1: Math.max(a.c1, b.c1), r1: Math.max(a.r1, b.r1) };
}

export function growRect(rect: GridRect, amount: number, cols: number, rows: number): GridRect {
	return {
		c0: Math.max(0, rect.c0 - amount),
		r0: Math.max(0, rect.r0 - amount),
		c1: Math.min(cols - 1, rect.c1 + amount),
		r1: Math.min(rows - 1, rect.r1 + amount),
	};
}
