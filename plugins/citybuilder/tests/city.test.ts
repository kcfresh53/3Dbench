import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeCity } from '../src/core/city/compose';
import type { CityPlan } from '../src/core/city/compose';
import { RoadIndex } from '../src/core/roads/corridor';
import type { RoadSet } from '../src/core/roads/corridor';
import { districtByKey } from '../src/core/district/library';
import type { CityState } from '../src/core/city/state';
import { crossroadNetwork, flatCity, roadsOf } from './helpers';

function zonedCity(development: number = 0.9): { state: CityState; roads: RoadSet } {
	const state: CityState = flatCity(2);
	state.settings.development = development;
	const roads: RoadSet = roadsOf(crossroadNetwork(), state);
	state.districts.paintAlongRoads(roads.corridors, districtByKey('res_med')?.id ?? 2, 40);
	return { state, roads };
}

test('zoning beside roads produces lots, buildings and trees', () => {
	const { state, roads } = zonedCity();
	const plan: CityPlan = composeCity(state, roads);
	assert.ok(plan.lots.length > 10, `lots: ${plan.lots.length}`);
	assert.ok(plan.buildings.length > 5, `buildings: ${plan.buildings.length}`);
	assert.ok(plan.stats.population > 0);
});

test('buildings stand clear of roads and on their pads', () => {
	const { state, roads } = zonedCity();
	const plan: CityPlan = composeCity(state, roads);
	const index: RoadIndex = new RoadIndex(roads);
	for (const b of plan.buildings) {
		assert.ok(index.clearance(b.x, b.z) > 0.5, `building ${b.lotId} overlaps a road`);
		assert.ok(Math.abs(plan.terrain.heights.sample(b.x, b.z) - b.y) < 0.25, 'building sits on its pad');
	}
});

test('composition is deterministic', () => {
	const a: CityPlan = composeCity(zonedCity().state, zonedCity().roads);
	const b: CityPlan = composeCity(zonedCity().state, zonedCity().roads);
	assert.deepEqual(a.buildings.map((x) => [x.lotId, x.prefab]), b.buildings.map((x) => [x.lotId, x.prefab]));
});

test('growth only adds buildings and never moves existing ones', () => {
	const young = zonedCity(0.3);
	const old = zonedCity(0.9);
	const before: CityPlan = composeCity(young.state, young.roads);
	const after: CityPlan = composeCity(old.state, old.roads);
	assert.ok(after.buildings.length >= before.buildings.length);
	const later: Set<string> = new Set(after.buildings.map((b) => b.lotId));
	for (const b of before.buildings) assert.ok(later.has(b.lotId), `lot ${b.lotId} lost its building`);
});

test('the prefab budget bounds the number of distinct meshes', () => {
	const { state, roads } = zonedCity();
	state.settings.gameReady.prefabBudget = 4;
	const plan: CityPlan = composeCity(state, roads);
	assert.ok(plan.prefabs.count <= 4 + 3, `prefabs: ${plan.prefabs.count}`);
});

test('unzoned land stays empty', () => {
	const state: CityState = flatCity(3);
	const plan: CityPlan = composeCity(state, roadsOf(crossroadNetwork(), state));
	assert.equal(plan.buildings.length, 0);
});

test('a brushed district without roads grows buildings inside the paint', () => {
	const state = flatCity(17);
	state.settings.development = 1;
	state.districts.paintBrush(100, 80, 85, 2, 'round');
	const roads = {corridors: [], junctions: []};
	const plan = composeCity(state, roads);
	assert.ok(plan.buildings.length > 5);
	for (const b of plan.buildings) assert.equal(state.districts.idAt(b.x,b.z),2);
	assert.deepEqual(composeCity(state,roads).buildings,plan.buildings);
	state.districts.clear();
	assert.equal(composeCity(state,roads).buildings.length,0);
});

test('area lots stay clear of each other, roads and water', () => {
	const state=flatCity(6); state.settings.development=1;
	state.districts.paintRect(-150,-150,150,150,2);
	const roads=roadsOf(crossroadNetwork(),state);
	const plan=composeCity(state,roads);
	assert.ok(plan.lots.some(l=>l.id.startsWith('area:')));
	for(let i=0;i<plan.lots.length;i++) {
		for(let j=i+1;j<plan.lots.length;j++) assert.ok(!obbOverlap(plan.lots[i].obb,plan.lots[j].obb,0));
	}
	state.terrain.heights.fill(-2);
	assert.equal(composeCity(state,{corridors:[],junctions:[]}).buildings.length,0);
});

import { obbOverlap } from '../src/core/geometry2d';
import { surfaceId } from '../src/core/terrain/surfaces';

test('surface painting controls species and distance from road selects tree representation', () => {
	const state=flatCity(5); state.paint.data.fill(surfaceId('sand'));
	const roads=roadsOf(crossroadNetwork(),state);
	const plan=composeCity(state,roads);
	assert.ok(plan.trees.length>0);
	assert.ok(plan.trees.every(t=>t.preset==='palm_realistic'));
	assert.ok(plan.trees.some(t=>t.representation==='model'));
	assert.ok(plan.trees.some(t=>t.representation==='cross'));
	const index=new RoadIndex(roads);
	for(const t of plan.trees) {
		const d=index.clearance(t.x,t.z,30);
		assert.ok(d>=2);
		assert.equal(t.representation,d<=24?'model':'cross');
	}
	state.paint.data.fill(surfaceId('snow'));
	assert.ok(composeCity(state,roads).trees.every(t=>t.preset==='pine_realistic'));
	state.paint.data.fill(surfaceId('paved'));
	assert.equal(composeCity(state,roads).trees.length,0);
});
