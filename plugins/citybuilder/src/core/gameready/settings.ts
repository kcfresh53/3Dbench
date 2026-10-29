/** How a city or a single building is prepared for use in a game engine. */
export interface GameReadySettings {
	preserveTextureDetail: boolean;
	/** Side of the packed texture atlas in pixels (power of two). */
	atlasSize: 512 | 1024 | 2048 | 4096;
	/** Facade resolution. The packer lowers it automatically when the atlas would overflow. */
	texelsPerMeter: number;
	/** Also write roughness/metallic/occlusion and normal pages so glass and metal respond to light and reflections. */
	pbr: boolean;
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
}

export const DEFAULT_GAME_READY: GameReadySettings = {
	preserveTextureDetail: true,
	atlasSize: 2048,
	texelsPerMeter: 32,
	pbr: true,
	gutter: 2,
	bakeFacades: true,
	lods: true,
	collision: 'boxes',
	prefabBudget: 48,
};
