import { Rng } from '../core/rng';
import type { Ctx2D, PixelRect } from './canvas_types';
/** Furrowed bark: dark wandering fissures, lighter ridges either side, speckle and short cracks. */
export declare function paintBarkRealistic(ctx: Ctx2D, r: PixelRect, base: string, rng: Rng): void;
/** Dense broadleaf cluster on short stems, alpha-cut at the silhouette. */
export declare function paintLeafCardBroadleaf(ctx: Ctx2D, r: PixelRect, colorA: string, colorB: string, rng: Rng): void;
/** Conifer twig fan: central twigs covered in short needles. */
export declare function paintLeafCardNeedle(ctx: Ctx2D, r: PixelRect, colorA: string, colorB: string, rng: Rng): void;
/** Mottled opaque leaf field (used if a realistic preset is switched to blobs/tiers). */
export declare function paintSolidRealistic(ctx: Ctx2D, r: PixelRect, colorA: string, colorB: string, rng: Rng): void;
/** Pale, papery bark with transverse lenticels instead of vertical furrows. */
export declare function paintBirchBark(ctx: Ctx2D, r: PixelRect, base: string, rng: Rng): void;
