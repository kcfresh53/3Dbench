import type { TreeLod } from '../core/types';
export interface TreePreview {
    update(lods: TreeLod[], atlasUrl: string, pixelated: boolean, status: string): void;
    dispose(): void;
}
/** Isolated orbit viewport with its own renderer (same approach as the building preview). */
export declare function makePreview(canvas: HTMLCanvasElement, status: HTMLElement): TreePreview;
