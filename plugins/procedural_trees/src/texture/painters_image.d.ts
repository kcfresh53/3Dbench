import type { Ctx2D, PixelRect } from './canvas_types';
export declare function loadImage(source: string): Promise<HTMLImageElement>;
/**
 * Fills the bark region with the image, tiled along V with alternate tiles mirrored
 * so the join between repeats is hidden even when the photo is not seamless.
 */
export declare function drawBarkImage(ctx: Ctx2D, r: PixelRect, image: HTMLImageElement): void;
/** Fits the whole image (alpha preserved) inside the square leaf region. */
export declare function drawLeafImage(ctx: Ctx2D, r: PixelRect, image: HTMLImageElement, tint?: string): void;
