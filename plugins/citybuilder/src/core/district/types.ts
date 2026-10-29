/** What a plot may be used for. Mirrors the zoning groups of classic city builders. */
export type ZoneKind = 'residential' | 'commercial' | 'office' | 'industrial' | 'civic' | 'park' | 'forest' | 'mixed';

export interface DistrictType {
	/** Stable id stored in saved cities. Never reuse an id. */
	id: number;
	key: string;
	label: string;
	zone: ZoneKind;
	/** Overlay colour shown while zoning. */
	color: string;
	/** Share of eligible lots that get a building when the city is fully developed, 0..1. */
	fill: number;
	/** Lot width range along the road, metres. */
	lotWidth: [number, number];
	/** Lot depth range away from the road, metres. */
	lotDepth: [number, number];
	/** Gap between the road's outer edge and the lot, metres. */
	frontGap: number;
	/** Gap between neighbouring lots, metres. */
	sideGap: number;
	/** Storeys at full development. */
	floors: [number, number];
	/** Building archetypes with relative weights. */
	archetypes: Array<{ id: string; weight: number }>;
	/** Indices into the building palette list. */
	palettes: number[];
	/** Trees per 100 square metres of free ground inside the lot or district. */
	treeDensity: number;
	/** Tree presets with relative weights (Procedural Trees names). */
	treeSpecies: Array<{ preset: string; weight: number }>;
	/** Whether the district gets buildings at all. */
	buildable: boolean;
}

export const NO_DISTRICT = 0;
