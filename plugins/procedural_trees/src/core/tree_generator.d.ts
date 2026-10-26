import type { MeshData, TreeLod, TreeParams } from './types';
interface RawTree {
    trunk: MeshData;
    foliage: MeshData;
    triangles: number;
}
/** One deterministic build at a given quality (1 = full detail). */
export declare function buildTree(p: TreeParams, quality: number): RawTree;
/** Finds the highest quality whose triangle count fits the budget. */
export declare function fitToBudget(p: TreeParams, budget: number): TreeLod;
/** LOD0 at the full budget, extra LODs at 50% / 25%, sharing an origin unless spreadLods is enabled. */
export declare function generateTreeSet(p: TreeParams): TreeLod[];
export {};
