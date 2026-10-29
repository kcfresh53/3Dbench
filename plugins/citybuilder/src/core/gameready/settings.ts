/** How a city or a single building is prepared for use in a game engine. */
export interface GameReadySettings {
	preserveTextureDetail: boolean;
	/** Side of the packed texture atlas in pixels (power of two). */
	atlasSize: 512 | 1024 | 2048 | 4096;
	/** Facade resolution. The packer lowers it automatically when the atlas would overflow. */
	texelsPerMeter: number;
	/** Pixels of edge padding around every packed rectangle, which prevents mip bleeding. */
	gutter: number;
	/** Bake every wall into one texture region instead of one quad per bay. */
	bakeFacades: boolean;
	/** Generate coarser levels of detail. */
	lods: boolean;
	/** Collision shapes written alongside the meshes. */
	collision: 'none' | 'boxes';
	/** Largest number of distinct building meshes in a city. */
	prefabBudget: number;
	/** Reduction targets for imported meshes: triangle fraction kept per level of detail. */
	lodRatios: [number, number];
	/** Geometric error allowed when simplifying imported meshes, in metres. */
	maxError: number;
}

export const DEFAULT_GAME_READY: GameReadySettings = {
	preserveTextureDetail: true,
	atlasSize: 2048,
	texelsPerMeter: 14,
	gutter: 2,
	bakeFacades: true,
	lods: true,
	collision: 'boxes',
	prefabBudget: 48,
	lodRatios: [0.5, 0.15],
	maxError: 0.05,
};
