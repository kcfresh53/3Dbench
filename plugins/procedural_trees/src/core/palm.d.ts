import type { TreeParams } from './types';
/** Coconut-style palm: one curved stem and a crown of pinnate arching fronds. */
export declare function buildPalm(p: TreeParams, quality: number): {
    trunk: import("./types").MeshData;
    foliage: import("./types").MeshData;
    triangles: number;
};
