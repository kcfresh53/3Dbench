import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bakedMesh } from '../src/core/buildings/mesh';
import { silhouetteMesh } from '../src/core/buildings/mesh';
import type { BuildingModel } from '../src/core/buildings/types';
import { packBuildings } from '../src/core/gameready/atlas';
import type { BuildingInput } from '../src/core/gameready/atlas';
import { composeCity } from '../src/core/city/compose';
import { districtByKey } from '../src/core/district/library';
import { crossroadNetwork, flatCity, roadsOf } from './helpers';

function inputsFromCity(): BuildingInput[] {
	const state = flatCity(5);
	const roads = roadsOf(crossroadNetwork(), state);
	state.districts.paintAlongRoads(roads.corridors, districtByKey('mixed')?.id ?? 12, 40);
	const plan = composeCity(state, roads);
	return plan.prefabs.all().map((p, i): BuildingInput => {
		const model: BuildingModel = p.model;
		return { name: `b${i}`, runs: model.facades, lods: [bakedMesh(model, 0), bakedMesh(model, 1), silhouetteMesh(model)] };
	});
}

test('packed UVs stay inside the atlas and touch no unpainted texel', () => {
	const inputs = inputsFromCity();
	assert.ok(inputs.length > 0);
	const atlas = packBuildings(inputs, 2048, 2, 14);
	for (const building of atlas.buildings) {
		for (const lod of building.lods) {
			for (const face of lod.faces) {
				for (const uv of face.uvs) {
					assert.ok(uv[0] >= 0 && uv[0] <= 1 && uv[1] >= 0 && uv[1] <= 1, `uv ${uv}`);
					const px = Math.min(atlas.size - 1, Math.floor(uv[0] * atlas.size));
					const py = Math.min(atlas.size - 1, Math.floor(uv[1] * atlas.size));
					const [r, g, b] = atlas.raster.get(px, py);
					assert.ok(!(r === 255 && g === 0 && b === 255), 'sampled the empty-atlas colour');
				}
			}
		}
	}
});

test('a small atlas lowers the resolution instead of failing', () => {
	const inputs = inputsFromCity();
	const big = packBuildings(inputs, 4096, 2, 14);
	const small = packBuildings(inputs, 1024, 2, 14);
	assert.ok(small.texelsPerMeter < big.texelsPerMeter);
});

test('the game package lists every file the manifest and loader refer to', async () => {
	const { buildGamePackage } = await import('../src/core/gameready/package');
	const state = flatCity(6);
	const roads = roadsOf(crossroadNetwork(), state);
	state.districts.paintAlongRoads(roads.corridors, districtByKey('mixed')?.id ?? 12, 40);
	const plan = composeCity(state, roads);
	const pkg = buildGamePackage(plan, state);
	const paths: Set<string> = new Set(pkg.files.map((f) => f.path));
	assert.ok(paths.has('city.json') && paths.has('buildings/atlas.png') && paths.has('terrain/albedo.png') && paths.has('city_loader.gd'));
	for (const prefab of pkg.manifest.prefabs) {
		assert.equal(prefab.meshes.length, 3);
		for (const name of prefab.meshes) assert.ok(paths.has(`buildings/${name}.obj`), `${name} exported`);
		assert.ok(prefab.collision.length > 0);
	}
	for (const chunk of pkg.manifest.terrain.chunks) assert.ok(paths.has(chunk));
	assert.equal(pkg.manifest.buildings.length, plan.buildings.length);
	assert.ok(pkg.report.prefabTriangles[0] > pkg.report.prefabTriangles[2], 'LOD2 is lighter than LOD0');
	const obj = pkg.files.find((f) => f.path.startsWith('buildings/building_0'))?.text ?? '';
	assert.match(obj, /^v /m);
	assert.match(obj, /^f \d+\/\d+/m);
});
