/** Shared 2D drawing surface type so painters work with both DOM and offscreen canvases. */
export type Ctx2D = CanvasRenderingContext2D;
export interface PixelRect {
    x: number;
    y: number;
    w: number;
    h: number;
}
