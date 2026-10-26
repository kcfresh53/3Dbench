import type { Vec3 } from './types';
import { MeshBuilder } from './mesh_builder';
import { Rng } from './rng';
/** A volume of individually oriented alpha-cut leaves or needle sprigs. */
export declare function addCardCluster(mb: MeshBuilder, center: Vec3, size: number, planes: number, rng: Rng): void;
/** Original crossed-card clusters for the stylized look. */
export declare function addStylizedCardCluster(mb: MeshBuilder, center: Vec3, size: number, planes: number, rng: Rng): void;
/** Lumpy low-poly leaf blob. Downward faces are dropped on the icosahedron. */
export declare function addBlob(mb: MeshBuilder, center: Vec3, size: number, detail: number, rng: Rng): void;
/** Open cone skirt (no base cap): `sides` triangles. Used for conifer tiers. */
export declare function addConeTier(mb: MeshBuilder, baseCenter: Vec3, apex: Vec3, radius: number, sides: number, rotation: number, rng: Rng): void;
