import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARCHETYPES } from '../src/core/buildings/archetypes';
import { buildModel } from '../src/core/buildings/massing';
import { bakedMesh, meshTriangles, modularMesh, silhouetteMesh } from '../src/core/buildings/mesh';
import type { BuildingSpec } from '../src/core/buildings/types';
import { planBuilding } from '../src/core/buildings/plan';
import { DISTRICT_TYPES } from '../src/core/district/library';

function specFor(archetype: string, floors: number): BuildingSpec {
	const a = ARCHETYPES.find((x) => x.id === archetype);
	assert.ok(a);
	return {
		archetype, style: a.style, shape: 'rect', roof: a.roofs[0][0], nx: 4, nz: 4, bay: a.bay, floors, floorHeight: a.floorHeight, groundHeight: a.groundHeight,
		palette: 0, seed: 0, shopfront: a.shopfront, awning: false, balconies: false, parapet: a.parapet, props: [], pitch: a.pitch[1] > 0 ? 28 : 0,
	};
}

test('every archetype builds a closed, upward-roofed model at several heights', () => {
	for (const a of ARCHETYPES) {
		for (const floors of [a.floors[0], a.floors[1]]) {
			const model = buildModel(specFor(a.id, floors));
			assert.ok(model.facades.length >= 4, `${a.id}: walls`);
			assert.ok(model.volumes.length >= 1);
			const mesh = modularMesh(model, 0);
			assert.ok(meshTriangles(mesh) > 8, `${a.id}: triangles`);
		}
	}
});

test('wall quads face outward', () => {
	const model = buildModel(specFor('apartment', 5));
	const mesh = bakedMesh(model, 0);
	for (const face of mesh.faces) {
		if (!face.material.startsWith('facade:')) continue;
		const run = model.facades.find((r) => `facade:${r.id}` === face.material);
		assert.ok(run);
		const [a, b, c] = face.indices.map((i: number) => mesh.positions[i]);
		const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
		const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
		const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
		assert.ok(n[0] * run.normal[0] + n[1] * run.normal[1] + n[2] * run.normal[2] > 0, 'normal points out');
	}
});

test('baked meshes are far lighter than modular ones, silhouettes lighter still', () => {
	const model = buildModel(specFor('office_mid', 12));
	const modular: number = meshTriangles(modularMesh(model, 0));
	const baked: number = meshTriangles(bakedMesh(model, 0));
	const box: number = meshTriangles(silhouetteMesh(model));
	assert.ok(baked < modular / 3, `baked ${baked} vs modular ${modular}`);
	assert.ok(box < baked);
});

test('planner respects lot size and is stable per lot', () => {
	const district = DISTRICT_TYPES.find((d) => d.key === 'res_low');
	assert.ok(district);
	const ctx = { development: 0.8, value: 0.5, variants: 3, seed: 1 };
	assert.equal(planBuilding(district, 'tiny', 3, 3, ctx), null);
	const a = planBuilding(district, 'lot-1', 14, 24, ctx);
	const b = planBuilding(district, 'lot-1', 14, 24, ctx);
	assert.ok(a);
	assert.deepEqual(a, b);
	assert.ok(a.width <= 14 && a.depth <= 24);
});

test('higher land value and development build taller', () => {
	const district = DISTRICT_TYPES.find((d) => d.key === 'office');
	assert.ok(district);
	let low = 0;
	let high = 0;
	for (let i = 0; i < 40; i++) {
		low += planBuilding(district, `l${i}`, 40, 40, { development: 0.1, value: 0.1, variants: 3, seed: 1 })?.spec.floors ?? 0;
		high += planBuilding(district, `l${i}`, 40, 40, { development: 1, value: 1, variants: 3, seed: 1 })?.spec.floors ?? 0;
	}
	assert.ok(high > low * 1.5, `${high} vs ${low}`);
});
