import type { Ctx2D, PixelRect } from './canvas_types';
import { Rng } from '../core/rng';
/** Ringed palm bark, rather than the vertical fissures of a hardwood trunk. */
export declare function paintPalmBark(ctx: Ctx2D, r: PixelRect, base: string, rng: Rng): void;
/** The leaflet mesh supplies its silhouette; this fills only its sampled atlas tile. */
export declare function paintPalmLeaf(ctx: Ctx2D, r: PixelRect, a: string, b: string): void;
