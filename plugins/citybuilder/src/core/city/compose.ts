import { PrefabLibrary } from '../buildings/prefabs';
import type { Prefab } from '../buildings/prefabs';
import { isBuilt, planBuilding } from '../buildings/plan';
import type { Plan, PlanContext } from '../buildings/plan';
import type { BuildingSpec } from '../buildings/types';
import { districtById } from '../district/library';
import type { DistrictType } from '../district/types';
import { localToWorld, yawOf } from '../geometry2d';
import type { Obb } from '../geometry2d';
import { generateLots } from '../lots/generate';
import type { Lot } from '../lots/types';
import { scatterTrees } from '../nature/scatter';
import type { PlacedTree } from '../nature/scatter';
import { RoadIndex } from '../roads/corridor';
import type { RoadJunction, RoadSet } from '../roads/corridor';
import type { Roundabout } from './settings';
import { conformDiscs, conformLots, conformRoads } from '../terrain/conform';
import type { ConformResult } from '../terrain/conform';
import { classifyCells } from '../terrain/surfaces';
import type { ByteGrid } from '../grid';
import { assignLandValue } from './landvalue';
import type { CityState } from './state';
import { computeStats } from './stats';
import type { CityStats } from './stats';

export interface PlacedBuilding {
	lotId: string;
	districtId: number;
	x: number;
	y: number;
	z: number;
	/** Rotation about +Y, Three.js convention. */
	yaw: number;
	spec: BuildingSpec;
	/** Horizontal fit when an instanced prefab is larger than this lot. */
	scale?: [number, number, number];
	width: number;
	depth: number;
	/** Key of the shared mesh this building instances. */
	prefab: string;
}

export interface CityPlan {
	/** The terrain after roads and building pads have shaped it. */
	terrain: ConformResult;
	lots: Lot[];
	buildings: PlacedBuilding[];
	trees: PlacedTree[];
	/** Surface id per terrain cell. */
	surfaces: ByteGrid;
	prefabs: PrefabLibrary;
	/** The road network the city was built around, in city metres. */
	roads: RoadSet;
	stats: CityStats;
}

/** Building footprint as a box in world space. */
function footprint(lot: Lot, plan: Plan): Obb {
	const [cx, cz] = localToWorld(lot.obb, plan.offsetX, plan.offsetZ);
	return { cx, cz, hw: plan.width / 2, hd: plan.depth / 2, ux: lot.obb.ux, uz: lot.obb.uz };
}

/**
 * Turns the hand-made state (terrain, zoning) and the road network into a finished city: shaped
 * terrain, lots, buildings and trees. The result depends only on its inputs, so it can be rebuilt
 * at any time and growth never moves existing buildings.
 */
export function composeCity(state: CityState, plainRoads: RoadSet): CityPlan {
	const s = state.settings;
	const roads: RoadSet = withRoundabouts(plainRoads, s.roundabouts);
	let terrain: ConformResult = conformRoads(state.terrain, roads.corridors, s.conform);
	terrain = conformDiscs(terrain, s.roundabouts, s.conform);
	const lots: Lot[] = s.features.buildings ? generateLots(roads, state.districts, terrain.heights, s.waterLevel, s.lot) : [];
	assignLandValue(lots, s.waterLevel, s.seed);
	terrain = conformLots(terrain, lots, s.conform);

	const prefabs: PrefabLibrary = new PrefabLibrary(s.gameReady.prefabBudget);
	const buildings: PlacedBuilding[] = [];
	const footprints: Obb[] = [];
	for (const lot of lots) {
		const district: DistrictType | undefined = districtById(lot.districtId);
		if (!district) continue;
		const ctx: PlanContext = { development: s.development, value: lot.value, variants: s.variants, seed: s.seed };
		if (!isBuilt(district, lot.id, ctx)) continue;
		const plan: Plan | null = planBuilding(district, lot.id, lot.width, lot.depth, ctx);
		if (!plan) continue;
		const prefab: Prefab = prefabs.resolve(plan.spec);
		const [x, z] = localToWorld(lot.obb, plan.offsetX, plan.offsetZ);
		buildings.push({ lotId: lot.id, districtId: lot.districtId, x, y: lot.padHeight, z, yaw: yawOf(lot.obb), spec: prefab.model.spec, scale: [Math.min(1, plan.width / prefab.model.width), 1, Math.min(1, plan.depth / prefab.model.depth)], width: Math.min(plan.width, prefab.model.width), depth: Math.min(plan.depth, prefab.model.depth), prefab: prefab.key });
		footprints.push(footprint(lot, plan));
	}

	const surfaces: ByteGrid = classifyCells(terrain.heights, state.paint, s.surface);
	const index: RoadIndex = new RoadIndex(roads);
	const trees: PlacedTree[] = s.features.trees
		? scatterTrees({
				hf: terrain.heights,
				districts: state.districts,
				roads: index,
				footprints,
				surfaces,
				waterLevel: s.waterLevel,
				seed: s.seed,
				density: s.treeScale,
				maxTrees: s.maxTrees,
				variants: s.variants,
			})
		: [];
	return { terrain, lots, buildings, trees, surfaces, prefabs, roads, stats: computeStats(buildings.length, lots.length, trees.length, prefabs.count) };
}

/** Roundabout islands keep lots away like a very wide junction. */
function withRoundabouts(roads: RoadSet, roundabouts: Roundabout[]): RoadSet {
	if (roundabouts.length === 0) return roads;
	const islands: RoadJunction[] = roundabouts.map((r: Roundabout, i: number): RoadJunction => ({ id: `roundabout:${i}`, x: r.x, y: r.y, z: r.z, radius: r.island, degree: 0 }));
	return { corridors: roads.corridors, junctions: [...roads.junctions, ...islands] };
}
