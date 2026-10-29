import type { Vec3 } from '../types';
import { DEFAULT_GAME_READY } from '../gameready/settings';
import type { GameReadySettings } from '../gameready/settings';
import { DEFAULT_LOT_SETTINGS } from '../lots/types';
import type { LotSettings } from '../lots/types';
import { DEFAULT_CONFORM } from '../terrain/conform';
import type { ConformSettings } from '../terrain/conform';
import { DEFAULT_RULES } from '../terrain/surfaces';
import type { SurfaceRules } from '../terrain/surfaces';

export interface CitySettings {
	seed: number;
	/** Terrain vertices along X and Z. */
	cols: number;
	rows: number;
	/** Metres between terrain vertices. */
	cellSize: number;
	waterLevel: number;
	/** Blockbench units per metre of city. The live city is scaled by this, and roads are read through it. */
	unitsPerMeter: number;
	/** How built-up the city is, 0..1. Growth only adds buildings. */
	development: number;
	/** Distinct detail seeds per building look; lower means more instancing. */
	variants: number;
	/** Multiplier on district tree density. */
	treeScale: number;
	maxTrees: number;
	lot: LotSettings;
	conform: ConformSettings;
	surface: SurfaceRules;
	gameReady: GameReadySettings;
	/** Direction towards the sun, used for baked terrain shading. */
	sun: Vec3;
	/** Size of the baked terrain albedo in pixels. */
	terrainTextureMode: 'chunks' | 'single';
	terrainTexture: 512 | 1024 | 2048 | 4096;
}

export const DEFAULT_CITY_SETTINGS: CitySettings = {
	seed: 1,
	cols: 129,
	rows: 129,
	cellSize: 8,
	waterLevel: 0,
	unitsPerMeter: 1,
	development: 0.8,
	variants: 3,
	treeScale: 1,
	maxTrees: 5000,
	lot: { ...DEFAULT_LOT_SETTINGS },
	conform: { ...DEFAULT_CONFORM },
	surface: { ...DEFAULT_RULES },
	gameReady: { ...DEFAULT_GAME_READY },
	sun: [0.45, 0.8, 0.35],
	terrainTextureMode: 'chunks',
	terrainTexture: 1024,
};

/** Fills gaps in loaded settings with defaults, so old saves keep working when options are added. */
export function mergeSettings(partial: Partial<CitySettings> | undefined): CitySettings {
	const d: CitySettings = DEFAULT_CITY_SETTINGS;
	const p: Partial<CitySettings> = partial ?? {};
	return {
		...d,
		...p,
		lot: { ...d.lot, ...p.lot },
		conform: { ...d.conform, ...p.conform },
		surface: { ...d.surface, ...p.surface },
		gameReady: { ...d.gameReady, ...p.gameReady },
		sun: p.sun ?? d.sun,
	};
}
