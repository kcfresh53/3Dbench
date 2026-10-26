import type { Branch, TreeParams, Vec3 } from './types';
import { Rng } from './rng';
export interface PathSample {
    position: Vec3;
    direction: Vec3;
    radius: number;
}
/** Position, direction and radius at fraction t (0..1) along a branch. */
export declare function samplePath(branch: Branch, t: number): PathSample;
/**
 * Builds a stable branch skeleton. Quality prunes detail from the complete
 * hierarchy without changing retained paths.
 */
export declare function growSkeleton(params: TreeParams, quality: number, rng: Rng): Branch[];
