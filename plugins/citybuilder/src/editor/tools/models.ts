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
