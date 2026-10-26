import type { Branch } from './types';
import { MeshBuilder } from './mesh_builder';
import type { UvRect } from './uv_layout';
/**
 * Adds a tapered tube along a branch. Rings share vertices between segments,
 * the tip collapses to a single vertex, and there are no end caps: the base
 * starts buried inside the parent so nothing hidden is ever generated.
 */
export declare function addBranchTube(mb: MeshBuilder, branch: Branch, sides: number, uv: UvRect): void;
