import type { BrushSettings } from '../../core/terrain/brush';
import { DEFAULT_BRUSH } from '../../core/terrain/brush';

export type LandscapeMode = BrushSettings['mode'] | 'surface';

/** What the landscape tool does, edited from the panel. */
export interface LandscapeModel {
	mode: LandscapeMode;
	brush: BrushSettings;
	/** Surface id painted by the surface mode (0 erases back to automatic). */
	surface: number;
}

export const DEFAULT_LANDSCAPE: LandscapeModel = { mode: 'raise', brush: { ...DEFAULT_BRUSH }, surface: 1 };

export type DistrictMode = 'brush' | 'rect' | 'polygon' | 'fill' | 'road' | 'erase';

export interface DistrictModel {
	mode: DistrictMode;
	/** Id of the district type being painted. */
	id: number;
	radius: number;
	shape: 'round' | 'square';
	/** How deep the zone reaches from the road edge, metres. */
	depth: number;
	/** Only zone ground that has no district yet. */
	onlyUnzoned: boolean;
}

export const DEFAULT_DISTRICT: DistrictModel = { mode: 'brush', id: 2, radius: 24, shape: 'round', depth: 36, onlyUnzoned: true };

export type RoadPaintMode = 'brush' | 'rect' | 'polygon';

/** What the road type tool does, edited from the panel and the toolbar. */
export interface RoadTypeModel {
	mode: RoadPaintMode;
	/** Road profile to paint; empty keeps each road's own profile. */
	profile: string;
	/** Structure to paint; 'keep' leaves each road's own structure. */
	structure: 'keep' | 'auto' | 'ground' | 'bridge' | 'tunnel' | 'air';
	radius: number;
}

export const DEFAULT_ROAD_TYPE: RoadTypeModel = { mode: 'brush', profile: '', structure: 'bridge', radius: 20 };

/** What the roundabout tool builds. */
export interface RoundaboutModel {
	/** Radius of the ring's centreline, metres. */
	radius: number;
	/** Road profile of the ring; empty derives one from the roads that meet there. */
	profile: string;
	/** Side of the road traffic drives on; sets which way it circulates. */
	hand: 'right' | 'left';
}

export const DEFAULT_ROUNDABOUT_MODEL: RoundaboutModel = { radius: 18, profile: '', hand: 'right' };
