import type { MeshPart, PartFace, TreeSpecLike, Vec3 } from './types';
import type { RoadLibrary } from './library_types';

export interface TreeAsset {
	/** Atlas key: assets with the same key share one texture. */
	key: string;
	/** Positions relative to the tree base, +Y up, in model units. */
	positions: Vec3[];
	faces: PartFace[];
	height: number;
	triangles: number;
}

/** Supplies ready-made trees. Returns an empty list while an asset is still being prepared. */
export interface TreeProvider {
	/** Changes whenever new assets become available, so cached geometry can be rebuilt. */
	readonly revision: number;
	assets(spec: TreeSpecLike, unitsPerMeter: number): TreeAsset[];
}

export const NO_TREES: TreeProvider = { revision: 0, assets: (): TreeAsset[] => [] };

export interface GenerationContext {
	library: RoadLibrary;
	trees: TreeProvider;
}

/** Per-lining density multipliers used when a triangle budget has to be met. */
export type DensityMap = Map<string, number>;

export interface BuildReport {
	treesPending: boolean;
	warnings: string[];
	/** Triangles spent on each lining element, used to thin props when a budget has to be met. */
	liningTriangles: Map<string, number>;
}

export function newReport(): BuildReport {
	return { treesPending: false, warnings: [], liningTriangles: new Map() };
}

export type { MeshPart };
