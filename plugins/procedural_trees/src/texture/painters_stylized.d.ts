import { Rng } from '../core/rng';
import type { Ctx2D, PixelRect } from './canvas_types';
/** Vertical streaks with a few breaks. Stretching along a branch is invisible. */
export declare function paintBarkStylized(ctx: Ctx2D, r: PixelRect, base: string, rng: Rng): void;
/** Chunky alpha-cut leaf cluster: the reference stylized look. */
export declare function paintLeafCardStylized(ctx: Ctx2D, r: PixelRect, colorA: string, colorB: string, rng: Rng): void;
/**
 * Opaque foliage field for blobs and tiers. Large soft clumps with a lighter
 * top edge, so even a small projected face reads as leafy rather than as noise.
 */
export declare function paintSolidStylized(ctx: Ctx2D, r: PixelRect, colorA: string, colorB: string, rng: Rng): void;
