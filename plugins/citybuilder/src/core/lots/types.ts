import type { Obb } from '../geometry2d';

/**
 * A plot beside a road where a building may stand. The lot frame is a pure rotation: local +X runs
 * along the road, local +Z points away from it, so the front facade sits at local z = -depth / 2.
 */
export interface Lot {
	id: string;
	roadId: string;
	side: 'left' | 'right';
	obb: Obb;
	width: number;
	depth: number;
	districtId: number;
	/** Ground height the building stands on after levelling. */
	padHeight: number;
	/** Highest minus lowest ground under the footprint before levelling. */
	relief: number;
	/** Lanes of the road the lot fronts. */
	roadLanes: number;
	/** Distance from the lot centre to the fronting road's centreline. */
	roadDistance: number;
	/** Land value 0..1 sampled at the lot, set after generation. */
	value: number;
}

export interface LotSettings {
	/** Maximum rise over run across a lot before it is rejected. */
	maxSlope: number;
	/** Lots must stay this high above the water line, metres. */
	waterMargin: number;
	/** Extra clearance kept between lots and other roads, metres. */
	roadMargin: number;
	/** Minimum share of probe points that must belong to the lot's district. */
	districtShare: number;
	seed: number;
}

export const DEFAULT_LOT_SETTINGS: LotSettings = { maxSlope: 0.32, waterMargin: 0.25, roadMargin: 0.6, districtShare: 0.7, seed: 11 };
