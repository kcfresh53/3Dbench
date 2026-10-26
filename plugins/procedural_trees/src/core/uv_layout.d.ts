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
export declare const REGION_BARK: Region;
export declare const REGION_LEAF_CARD: Region;
export declare const REGION_SOLID: Region;
/** Keeps bilinear filtering and mipmaps from bleeding neighbouring regions together. */
export declare const UV_INSET = 0.012;
export declare function insetRect(region: Region, inset?: number): UvRect;
export declare const BARK_UV: UvRect;
export declare const LEAF_CARD_UV: UvRect;
export declare const SOLID_UV: UvRect;
/** Corners in BL, BR, TR, TL order for a front-facing quad. */
export declare function quadUvs(rect: UvRect): Vec2[];
