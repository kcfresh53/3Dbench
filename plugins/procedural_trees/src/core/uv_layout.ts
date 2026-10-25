import type { Vec2 } from './types';

/** Normalised atlas rectangle in 0..1 space, origin top-left. */
export interface Region {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface UvRect {
	u0: number;
	u1: number;
	v0: number;
	v1: number;
}

/**
 * One atlas, one material, one draw call:
 *   left half    - bark (vertical streaks, stretches safely along branches)
 *   top right    - leaf card with alpha
 *   bottom right - opaque foliage field for blobs and tiers
 */
export const REGION_BARK: Region = { x: 0, y: 0, w: 0.5, h: 1 };
export const REGION_LEAF_CARD: Region = { x: 0.5, y: 0, w: 0.5, h: 0.5 };
export const REGION_SOLID: Region = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 };

/** Keeps bilinear filtering and mipmaps from bleeding neighbouring regions together. */
export const UV_INSET = 0.012;

export function insetRect(region: Region, inset: number = UV_INSET): UvRect {
	return {
		u0: region.x + inset,
		u1: region.x + region.w - inset,
		v0: region.y + inset,
		v1: region.y + region.h - inset,
	};
}

export const BARK_UV: UvRect = insetRect(REGION_BARK);
export const LEAF_CARD_UV: UvRect = insetRect(REGION_LEAF_CARD);
export const SOLID_UV: UvRect = insetRect(REGION_SOLID);

/** Corners in BL, BR, TR, TL order for a front-facing quad. */
export function quadUvs(rect: UvRect): Vec2[] {
	return [
		[rect.u0, rect.v1],
		[rect.u1, rect.v1],
		[rect.u1, rect.v0],
		[rect.u0, rect.v0],
	];
}
