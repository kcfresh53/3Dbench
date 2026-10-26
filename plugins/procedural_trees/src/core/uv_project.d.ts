import type { Vec2, Vec3 } from './types';
import type { Rng } from './rng';
import type { UvRect } from './uv_layout';
/**
 * Flat-projects one face into a randomly placed window of `rect`.
 * One uniform scale is used for both axes, so texels stay square (no stretch),
 * and the window is big enough that the face samples real texture detail
 * instead of a few pixels of noise.
 */
export declare function planarFaceUvs(corners: Vec3[], rect: UvRect, rng: Rng): Vec2[];
