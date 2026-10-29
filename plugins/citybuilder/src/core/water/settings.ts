import type { Vec2, Vec3 } from '../types';

/**
 * Parameters of the water preview. Names and meaning follow the Godot 4 water shader this was ported
 * from, so values can be copied across to a ShaderMaterial in the engine unchanged. The water itself is
 * never exported: the game renders its own.
 */
export interface WaterSettings {
	/** Draw the preview water. */
	show: boolean;
	/** Keep the surface moving. Costs a redraw per frame while the viewport is visible. */
	animate: boolean;
	/** `water_color`, linear 0..1. */
	color: Vec3;
	/** `color_ratio`: how much of the water colour replaces the ground seen through it. */
	colorRatio: number;
	/** `alpha_scale`: overall opacity. */
	alphaScale: number;
	/** `roughness`: sharpness of the sun's reflection. */
	roughness: number;
	/** `normal`: strength of the surface ripples. */
	normal: number;
	/** `time_scale`: speed of the ripples. */
	timeScale: number;
	/** `highlights_time_scale`: speed of the sun glitter. */
	highlightsTimeScale: number;
	/** `uv_scale`: how many times the textures repeat across the water sheet. */
	uvScale: number;
	/** `normal_blend`: mix between the two ripple maps. */
	normalBlend: number;
	/** `highlights_blend`: mix between the two glitter maps. */
	highlightsBlend: number;
	/** `depth_distance`: water deeper than this fades the ground colour out. */
	depthDistance: number;
	/** `foam_intensity` */
	foamIntensity: number;
	/** `foam_width`: how far from the shore foam reaches. */
	foamWidth: number;
	/** `shore_fade_distance`: water thinner than this turns transparent. */
	shoreFadeDistance: number;
	/** `abberation_r`, `abberation_g`, `abberation_b`: per-channel offsets of the glitter. */
	aberrationR: Vec2;
	aberrationG: Vec2;
	aberrationB: Vec2;
}

export const DEFAULT_WATER: WaterSettings = {
	show: true,
	animate: true,
	color: [0, 0.635, 0.639],
	colorRatio: 0.35,
	alphaScale: 0.8,
	roughness: 0.2,
	normal: 0.4,
	timeScale: 1,
	highlightsTimeScale: 0,
	uvScale: 40,
	normalBlend: 0.5,
	highlightsBlend: 0.5,
	depthDistance: 6,
	foamIntensity: 0.5,
	foamWidth: 0.6,
	shoreFadeDistance: 1,
	aberrationR: [0, 0],
	aberrationG: [0, 0],
	aberrationB: [0, 0],
};

export function mergeWater(partial: Partial<WaterSettings> | undefined): WaterSettings {
	return { ...DEFAULT_WATER, ...partial };
}
