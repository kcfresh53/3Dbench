import { collisionBoxes } from '../buildings/mesh';
import type { CollisionBox } from '../buildings/mesh';
import type { Prefab } from '../buildings/prefabs';
import { round } from '../math';
import type { CityPlan, PlacedBuilding } from './compose';
import type { CitySettings } from './settings';

export interface ManifestPrefab {
	id: string;
	atlas?: string;
	archetype: string;
	floors: number;
	/** Mesh node names per level of detail, finest first. */
	meshes: string[];
	collision: Array<{ center: number[]; size: number[] }>;
}

export interface CityManifest {
	format: 'citybuilder';
	version: 1;
	units: 'metres';
	up: 'y';
	terrain: { cols: number; rows: number; cellSize: number; origin: [number, number]; heightmap: string; albedo: string; chunks: string[]; chunkAlbedos?: string[] };
	waterLevel: number;
	prefabs: ManifestPrefab[];
	buildings: Array<{ prefab: string; position: number[]; yaw: number; district: number; lot: string }>;
	trees: Array<{ preset: string; position: number[]; yaw: number; scale: number; variant: number; representation: 'model' | 'cross'; asset?: string }>;
	treeAssets?: Record<string, {mesh: string; texture: string; triangles: number}>;
	stats: CityPlan['stats'];
}

function r3(n: number): number {
	return round(n, 3);
}

/** Describes the whole city as plain data: what to instance, where, and with which collision. */
export function buildManifest(plan: CityPlan, settings: CitySettings, meshNames: Map<string, string[]>, files: { heightmap: string; albedo: string; chunks: string[]; chunkAlbedos?: string[] }): CityManifest {
	const include = settings.export;
	const prefabs: ManifestPrefab[] = (include.buildings ? plan.prefabs.all() : []).map((p: Prefab): ManifestPrefab => ({
		id: p.key,
		archetype: p.model.spec.archetype,
		floors: p.model.spec.floors,
		meshes: meshNames.get(p.key) ?? [],
		collision: settings.gameReady.collision === 'boxes' ? collisionBoxes(p.model).map((b: CollisionBox) => ({ center: b.center.map(r3), size: b.size.map(r3) })) : [],
	}));
	const hf = plan.terrain.heights;
	return {
		format: 'citybuilder',
		version: 1,
		units: 'metres',
		up: 'y',
		terrain: { cols: hf.cols, rows: hf.rows, cellSize: hf.cellSize, origin: [hf.originX, hf.originZ], ...files },
		waterLevel: settings.waterLevel,
		prefabs,
		buildings: (include.buildings ? plan.buildings : []).map((b: PlacedBuilding) => ({ prefab: b.prefab, position: [r3(b.x), r3(b.y), r3(b.z)], yaw: r3(b.yaw), district: b.districtId, lot: b.lotId })),
		trees: (include.trees ? plan.trees : []).map((t) => ({ preset: t.preset, position: [r3(t.x), r3(t.y), r3(t.z)], yaw: r3(t.yaw), scale: r3(t.scale), variant: t.variant, representation: t.representation })),
		stats: plan.stats,
	};
}

/** 16-bit little-endian heightmap with a small header, convenient for Godot's `Image.create_from_data` or any engine. */
export function heightmapBytes(plan: CityPlan): Uint8Array {
	const hf = plan.terrain.heights;
	let min: number = Infinity;
	let max: number = -Infinity;
	for (const h of hf.heights) {
		min = Math.min(min, h);
		max = Math.max(max, h);
	}
	const span: number = Math.max(1e-6, max - min);
	const out: Uint8Array = new Uint8Array(16 + hf.heights.length * 2);
	const view: DataView = new DataView(out.buffer);
	view.setUint32(0, hf.cols, true);
	view.setUint32(4, hf.rows, true);
	view.setFloat32(8, min, true);
	view.setFloat32(12, max, true);
	hf.heights.forEach((h: number, i: number): void => view.setUint16(16 + i * 2, Math.round(((h - min) / span) * 65535), true));
	return out;
}
