import type { StripElement, StripType, SurfaceId, Weather } from './model';

export interface StripDefinition {
	type: StripType;
	label: string;
	width: number;
	top: number;
	surface: SurfaceId;
	minWidth: number;
	maxWidth: number;
}

/** Surface strips that can be stacked beside a carriageway. Widths and heights are metres. */
export const STRIP_TYPES: Record<StripType, StripDefinition> = {
	gutter: { type: 'gutter', label: 'Gutter', width: 0.3, top: -0.03, surface: 'gutter', minWidth: 0.1, maxWidth: 1.5 },
	curb: { type: 'curb', label: 'Curb', width: 0.2, top: 0.15, surface: 'curb', minWidth: 0.1, maxWidth: 0.6 },
	sidewalk: { type: 'sidewalk', label: 'Sidewalk', width: 2, top: 0.15, surface: 'sidewalk', minWidth: 0.5, maxWidth: 8 },
	shoulder: { type: 'shoulder', label: 'Shoulder', width: 2, top: 0, surface: 'asphalt', minWidth: 0.3, maxWidth: 6 },
	verge: { type: 'verge', label: 'Grass verge', width: 1.6, top: 0.1, surface: 'terrain', minWidth: 0.3, maxWidth: 12 },
	bike_lane: { type: 'bike_lane', label: 'Bike lane', width: 1.5, top: 0, surface: 'racing_red', minWidth: 0.8, maxWidth: 3 },
	parking: { type: 'parking', label: 'Parking lane', width: 2.4, top: 0, surface: 'asphalt', minWidth: 1.8, maxWidth: 3.5 },
	racing_curb: { type: 'racing_curb', label: 'Racing curb', width: 0.7, top: 0.06, surface: 'racing_red', minWidth: 0.3, maxWidth: 2 },
};

export const STRIP_ORDER: StripType[] = ['gutter', 'curb', 'sidewalk', 'verge', 'shoulder', 'bike_lane', 'parking', 'racing_curb'];

export function makeStrip(type: StripType, id: string, overrides: Partial<StripElement> = {}): StripElement {
	const def: StripDefinition = STRIP_TYPES[type];
	return { kind: 'strip', id, type, width: def.width, top: def.top, surface: def.surface, ...overrides };
}

/** Atlas tile for a logical surface. Weather swaps the colour imagery only. */
export function surfaceTile(surface: SurfaceId, weather: Weather): string {
	switch (surface) {
		case 'asphalt':
			return weather === 'wet' ? 'Road Wet' : 'Road';
		case 'trail':
			return weather === 'snow' ? 'Trail Support Snow' : 'Trail Support Spring';
		case 'sidewalk':
			return 'Sidewalk A';
		case 'curb':
			return 'Sidewalk Curb 1';
		case 'gutter':
			return 'Gutters Regular';
		case 'terrain':
			return weather === 'snow' ? 'Terrain Snow' : 'Terrain Spring';
		case 'deck':
			return 'Bridge Deck';
		case 'concrete':
			return 'Tunnel Barrier';
		case 'racing_red':
			return 'Racing Curb Red';
		case 'racing_white':
			return 'Racing Curb White';
	}
}

/** Real-world edge length (metres) one atlas tile covers, so texel density stays consistent. */
export function tileSizeMeters(tile: string): number {
	switch (tile) {
		case 'Road':
		case 'Road Wet':
		case 'Terrain Spring':
		case 'Terrain Snow':
		case 'Trail Support Spring':
		case 'Trail Support Snow':
		case 'Bridge Deck':
		case 'Tunnel Wall':
		case 'Tunnel Wall Upper':
			return 8;
		case 'Sidewalk A':
			return 3;
		case 'Sidewalk Curb 1':
		case 'Gutters Regular':
		case 'Bridge Column':
			return 2;
		default:
			return 3;
	}
}
