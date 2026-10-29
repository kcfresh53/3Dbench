import assert from 'node:assert/strict';
import test from 'node:test';
import { composeCity } from '../src/core/city/compose';
import { DEFAULT_CITY_SETTINGS, mergeSettings, settingsForKind } from '../src/core/city/settings';
import { districtByKey } from '../src/core/district/library';
import { buildGamePackage } from '../src/core/gameready/package';
import { crossroadNetwork, flatCity, roadsOf } from './helpers';

function zoned() {
	const state = flatCity(6);
	const roads = roadsOf(crossroadNetwork(), state);
	state.districts.paintAlongRoads(roads.corridors, districtByKey('mixed')?.id ?? 12, 40);
	return { state, roads };
}

test('a game package never contains water, only the water level', () => {
	const { state, roads } = zoned();
	const pkg = buildGamePackage(composeCity(state, roads), state);
	assert.ok(pkg.files.every((f) => !/water/i.test(f.path)), 'no water files');
	assert.equal(pkg.manifest.waterLevel, state.settings.waterLevel);
});

test('export settings leave out buildings, trees and terrain', () => {
	const { state, roads } = zoned();
	state.settings.export = { terrain: false, buildings: false, trees: false };
	const pkg = buildGamePackage(composeCity(state, roads), state);
	assert.equal(pkg.manifest.buildings.length, 0);
	assert.equal(pkg.manifest.prefabs.length, 0);
	assert.equal(pkg.manifest.trees.length, 0);
	assert.ok(!pkg.files.some((f) => f.path.startsWith('buildings/') || f.path.startsWith('terrain/')));
	assert.ok(pkg.files.some((f) => f.path === 'city.json'));
});

test('a track project generates no buildings and exports none', () => {
	const { state, roads } = zoned();
	state.settings = settingsForKind(state.settings, 'track');
	const plan = composeCity(state, roads);
	assert.equal(plan.buildings.length, 0);
	assert.equal(plan.stats.buildings, 0);
	assert.equal(state.settings.kind, 'track');
	assert.equal(state.settings.export.buildings, false);
});

test('settings survive a round trip and old documents get the new defaults', () => {
	const merged = mergeSettings({ water: { ...DEFAULT_CITY_SETTINGS.water, show: false } });
	assert.equal(merged.water.show, false);
	assert.equal(merged.water.animate, DEFAULT_CITY_SETTINGS.water.animate);
	const old = mergeSettings({ seed: 4 });
	assert.equal(old.kind, 'city');
	assert.equal(old.features.buildings, true);
	assert.deepEqual(old.roundabouts, []);
});

test('a roundabout island keeps lots off it and levels the ground', () => {
	const { state, roads } = zoned();
	const before = composeCity(state, roads);
	assert.ok(before.lots.length > 0);
	const target = before.lots[0].obb;
	state.settings.roundabouts = [{ x: target.cx, y: 0, z: target.cz, radius: 20, island: 12 }];
	const plan = composeCity(state, roads);
	for (const lot of plan.lots) assert.ok(Math.hypot(lot.obb.cx - target.cx, lot.obb.cz - target.cz) > 8, 'no lot sits on the island');
});

import { CityState } from '../src/core/city/state';
import { generateTerrain } from '../src/core/terrain/generate';
import { DEFAULT_LAYOUT, generateLayout } from '../src/core/city/layout';
import type { LayoutKind } from '../src/core/city/layout';

test('street layouts are connected, deterministic, mixed in rank and stay on dry ground', () => {
	const state = CityState.create({ seed: 5, cols: 129, rows: 129, cellSize: 6 });
	generateTerrain(state.terrain, { preset: 'coast', seed: 5 });
	for (const kind of ['grid', 'organic', 'radial'] as LayoutKind[]) {
		const options = { ...DEFAULT_LAYOUT, kind, seed: 7 };
		const a = generateLayout(state.terrain, state.settings.waterLevel, 1, options);
		const b = generateLayout(state.terrain, state.settings.waterLevel, 1, options);
		assert.deepEqual([...a.segments.keys()], [...b.segments.keys()], `${kind} is deterministic`);
		assert.ok(a.segments.size > 20, `${kind} has streets`);
		const profiles = new Set([...a.segments.values()].map((s) => s.profile));
		assert.ok(profiles.has('avenue') && profiles.has('street'), `${kind} has main roads and streets`);
		const reached = new Set<string>([a.nodes.keys().next().value!]);
		for (let n = 0; n < a.nodes.size; n++) for (const e of a.segments.values()) if (reached.has(e.a) || reached.has(e.b)) { reached.add(e.a); reached.add(e.b); }
		assert.equal(reached.size, a.nodes.size, `${kind} is one connected network`);
		for (const n of a.nodes.values()) assert.ok(state.terrain.sample(n.position[0], n.position[2]) >= state.settings.waterLevel, `${kind} node on dry ground`);
	}
});

test('different seeds give different organic layouts', () => {
	const state = CityState.create({ seed: 5, cols: 129, rows: 129, cellSize: 6 });
	generateTerrain(state.terrain, { preset: 'rolling', seed: 5 });
	const a = generateLayout(state.terrain, state.settings.waterLevel, 1, { ...DEFAULT_LAYOUT, seed: 1 });
	const b = generateLayout(state.terrain, state.settings.waterLevel, 1, { ...DEFAULT_LAYOUT, seed: 2 });
	assert.notDeepEqual([...a.nodes.values()].map((n) => n.position), [...b.nodes.values()].map((n) => n.position));
});

import { applyIsland, DEFAULT_ISLAND } from '../src/core/terrain/island';

test('island edges sink the border below the water without raising anything', () => {
	const state = CityState.create({ seed: 5, cols: 65, rows: 65, cellSize: 8 });
	generateTerrain(state.terrain, { preset: 'rolling', seed: 5 });
	const hf = state.terrain;
	const before = hf.heights.slice();
	const water = state.settings.waterLevel;
	applyIsland(hf, water, DEFAULT_ISLAND);
	for (let i = 0; i < hf.heights.length; i++) assert.ok(hf.heights[i] <= before[i] + 1e-6, 'never raised');
	for (let c = 0; c < hf.cols; c++) {
		assert.ok(hf.heights[hf.index(c, 0)] < water, 'north border under water');
		assert.ok(hf.heights[hf.index(c, hf.rows - 1)] < water, 'south border under water');
	}
	const mid = hf.index(32, 32);
	assert.equal(hf.heights[mid], before[mid], 'the middle is untouched');
	const again = hf.heights.slice();
	applyIsland(hf, water, DEFAULT_ISLAND);
	assert.ok(hf.heights.every((h, i) => h <= again[i] + 1e-6));
});

import { growIsland, restoreAll, snapshotAll } from '../src/core/city/grow';

test('growing an island adds ground around the map and leaves everything built untouched', () => {
	const state = CityState.create({ seed: 5, cols: 65, rows: 65, cellSize: 8 });
	generateTerrain(state.terrain, { preset: 'rolling', seed: 5 });
	state.districts.paintBrush(0, 0, 60, 3);
	state.paint.set(10, 12, 4);
	const old = state.terrain;
	const oldHeights = old.heights.slice();
	const oldDistricts = state.districts.grid.data.slice();
	const snap = snapshotAll(state);
	const pad = growIsland(state, { ...DEFAULT_ISLAND, grow: true });
	const hf = state.terrain;
	assert.ok(pad >= 2 && hf.cols === 65 + pad * 2 && hf.rows === 65 + pad * 2);
	assert.equal(state.settings.cols, hf.cols);
	// Every old vertex keeps its world position and height.
	for (let r = 0; r < 65; r++) for (let c = 0; c < 65; c++) {
		assert.equal(hf.heights[hf.index(c + pad, r + pad)], oldHeights[old.index(c, r)]);
		assert.equal(hf.worldX(c + pad), old.worldX(c));
	}
	// Zoning and painting moved with the ground.
	assert.equal(state.paint.get(10 + pad, 12 + pad), 4);
	for (let r = 0; r < old.cellRows; r++) for (let c = 0; c < old.cellCols; c++) assert.equal(state.districts.grid.get(c + pad, r + pad), oldDistricts[r * old.cellCols + c]);
	// The new border lies under the water, and nothing outside the old map is zoned.
	for (let c = 0; c < hf.cols; c++) assert.ok(hf.heights[hf.index(c, 0)] < state.settings.waterLevel);
	assert.equal(state.districts.grid.get(0, 0), 0);
	// Undo restores the original exactly.
	restoreAll(state, snap);
	assert.equal(state.terrain.cols, 65);
	assert.deepEqual(state.terrain.heights, oldHeights);
	assert.deepEqual(state.districts.grid.data, oldDistricts);
	assert.equal(state.settings.cols, 65);
});
