/** Transparent terrain layers must finish before water; editing overlays stay on top of both. */
export const CITY_RENDER_ORDER = {
	terrain: 0,
	water: 100,
	districts: 200,
} as const;
