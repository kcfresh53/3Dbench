import type { Vec3 } from '../types';
import { DEFAULT_GAME_READY } from '../gameready/settings';
import type { GameReadySettings } from '../gameready/settings';
import { DEFAULT_LOT_SETTINGS } from '../lots/types';
import type { LotSettings } from '../lots/types';
import { DEFAULT_CONFORM } from '../terrain/conform';
import type { ConformSettings } from '../terrain/conform';
import { DEFAULT_RULES } from '../terrain/surfaces';
import { DEFAULT_WATER, mergeWater } from '../water/settings';
import type { WaterSettings } from '../water/settings';
import type { SurfaceRules } from '../terrain/surfaces';

/** What the project is for. It only sets sensible defaults; every option stays editable. */
export type ProjectKind = 'city' | 'track' | 'landscape';

/** Which kinds of content the city generates. Turning one off also skips its work. */
export interface FeatureSettings {
	buildings: boolean;
	trees: boolean;
}

/** Which parts go into an exported game package. */
export interface ExportSettings {
	terrain: boolean;
	buildings: boolean;
	trees: boolean;
}

/** A roundabout made with the Roundabout tool: lots stay off the island and the ground under it is levelled. */
export interface Roundabout {
	x: number;
	y: number;
	z: number;
	/** Radius of the ring's centreline, metres. */
	radius: number;
	/** Radius of the island inside the ring, metres. */
	island: number;
}

export interface CitySettings {
	kind: ProjectKind;
	features: FeatureSettings;
	export: ExportSettings;
	water: WaterSettings;
	roundabouts: Roundabout[];
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
	kind: 'city',
	features: { buildings: true, trees: true },
	export: { terrain: true, buildings: true, trees: true },
	water: { ...DEFAULT_WATER },
	roundabouts: [],
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
		features: { ...d.features, ...p.features },
		export: { ...d.export, ...p.export },
		water: mergeWater(p.water),
		roundabouts: (p.roundabouts ?? []).map((r: Roundabout): Roundabout => ({ ...r })),
	};
}

/**
 * Starting points for different jobs. A track keeps the land, trees and roads and drops buildings; a
 * landscape keeps only the ground. Nothing is locked: change any option afterwards.
 */
export function settingsForKind(settings: CitySettings, kind: ProjectKind): CitySettings {
	const next: CitySettings = mergeSettings(JSON.parse(JSON.stringify(settings)) as Partial<CitySettings>);
	next.kind = kind;
	next.features = { buildings: kind === 'city', trees: kind !== 'landscape' };
	next.export = { terrain: true, buildings: kind === 'city', trees: kind !== 'landscape' };
	if (kind === 'track') {
		next.development = 0;
		next.treeScale = Math.min(next.treeScale, 0.6);
		next.conform = { ...next.conform, roads: true, roadBlend: Math.max(next.conform.roadBlend, 10) };
	}
	return next;
}
