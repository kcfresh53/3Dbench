import type { Branch, TreeParams } from './types';
import { MeshBuilder } from './mesh_builder';
import { Rng } from './rng';
/** Places foliage on terminal branches (or tiers on the trunk). */
export declare function addFoliage(mb: MeshBuilder, branches: Branch[], p: TreeParams, quality: number, rng: Rng): void;
