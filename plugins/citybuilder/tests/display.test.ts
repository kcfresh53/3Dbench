import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE_NS from 'three';
import { composeCity } from '../src/core/city/compose';
import type { CityPlan } from '../src/core/city/compose';
import { districtByKey } from '../src/core/district/library';
import { BuildingView } from '../src/editor/display/building_view';
import { CursorView } from '../src/editor/display/cursor_view';
import { LotView } from '../src/editor/display/lot_view';
import { TerrainView } from '../src/editor/display/terrain_view';
import { WaterView } from '../src/editor/display/water_view';
import type { ViewContext } from '../src/editor/display/view';
import { crossroadNetwork, flatCity, roadsOf } from './helpers';

// The editor views use the global THREE that Blockbench provides.
(globalThis as unknown as { THREE: typeof THREE_NS }).THREE = THREE_NS;

function context(): ViewContext {
	const state = flatCity(8);
	const roads = roadsOf(crossroadNetwork(), state);
	state.districts.paintAlongRoads(roads.corridors, districtByKey('mixed')?.id ?? 12, 40);
	const plan: CityPlan = composeCity(state, roads);
	return { state, plan };
}

function countTriangles(object: THREE_NS.Object3D): number {
	let n = 0;
	object.traverse((o) => {
		const mesh = o as THREE_NS.Mesh;
		if (!mesh.geometry) return;
		const g = mesh.geometry;
		const per = g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
		n += per * ((o as THREE_NS.InstancedMesh).isInstancedMesh ? (o as THREE_NS.InstancedMesh).count : 1);
	});
	return n;
}

test('terrain view builds patches that cover the map and follow live edits', () => {
	const ctx = context();
	const view = new TerrainView();
	view.rebuild(ctx);
	const hf = ctx.plan.terrain.heights;
	assert.ok(view.root.children.length > 0);
	assert.equal(countTriangles(view.root) / 2, (hf.cols - 1) * (hf.rows - 1) * 2, 'ground plus overlay share each triangle');
	const first = view.root.children[0] as THREE_NS.Mesh;
	const before = (first.geometry.getAttribute('position') as THREE_NS.BufferAttribute).getY(5);
	hf.heights.fill(50);
	view.liveEdit(hf, { c0: 0, r0: 0, c1: hf.cols, r1: hf.rows });
	const after = (first.geometry.getAttribute('position') as THREE_NS.BufferAttribute).getY(5);
	assert.notEqual(before, after);
	assert.equal(after, 50);
	view.showOverlay(true);
	assert.ok(view.root.children.some((c) => c.visible));
	view.dispose();
	assert.equal(view.root.children.length, 0);
});

test('district overlay colours follow the district map', () => {
	const ctx = context();
	const view = new TerrainView();
	view.rebuild(ctx);
	ctx.state.districts.paintBrush(0, 0, 30, districtByKey('park')?.id ?? 10);
	view.setDistricts(ctx.state.districts);
	view.dispose();
});

test('building view draws every building through a few instanced meshes', () => {
	const ctx = context();
	const view = new BuildingView();
	view.rebuild(ctx);
	let instances = 0;
	let meshes = 0;
	view.root.traverse((o) => {
		const m = o as THREE_NS.InstancedMesh;
		if (m.isInstancedMesh) {
			meshes++;
			instances += m.count;
			const uv = m.geometry.getAttribute('uv') as THREE_NS.BufferAttribute;
			for (let i = 0; i < uv.count; i++) {
				assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 1 && uv.getY(i) >= 0 && uv.getY(i) <= 1, 'uv inside the atlas');
			}
		}
	});
	assert.equal(instances, ctx.plan.buildings.length);
	assert.ok(meshes <= ctx.plan.prefabs.count);
	view.dispose();
});

test('instance matrices place buildings where the plan says, facing the lot frame', () => {
	const ctx = context();
	const view = new BuildingView();
	view.rebuild(ctx);
	const b = ctx.plan.buildings[0];
	let found = false;
	view.root.traverse((o) => {
		const m = o as THREE_NS.InstancedMesh;
		if (!m.isInstancedMesh || found) return;
		const mat = new THREE_NS.Matrix4();
		for (let i = 0; i < m.count; i++) {
			m.getMatrixAt(i, mat);
			const p = new THREE_NS.Vector3().setFromMatrixPosition(mat);
			if (Math.hypot(p.x - b.x, p.z - b.z) < 1e-4) {
				found = true;
				// Local +Z (the lot's depth axis) must map to the world direction pointing away from the road.
				const local = new THREE_NS.Vector3(0, 0, 1).applyMatrix4(new THREE_NS.Matrix4().extractRotation(mat));
				const lot = ctx.plan.lots.find((l) => l.id === b.lotId);
				assert.ok(lot);
				assert.ok(Math.abs(local.x - -lot.obb.uz) < 1e-4 && Math.abs(local.z - lot.obb.ux) < 1e-4, 'depth axis matches the lot frame');
			}
		}
	});
	assert.ok(found, 'first building has an instance');
	view.dispose();
});

test('lot, water and cursor views build without errors', () => {
	const ctx = context();
	const lots = new LotView();
	lots.rebuild(ctx);
	assert.equal(lots.root.children.length, 1);
	assert.ok(((lots.root.children[0] as THREE_NS.LineSegments).geometry.getAttribute("position") as THREE_NS.BufferAttribute).count > 0, "lot outlines exist");
	const water = new WaterView();
	water.rebuild(ctx);
	assert.equal(water.root.children.length, 1);
	const cursor = new CursorView();
	cursor.brush(ctx.plan.terrain.heights, 0, 0, 20, 'round', 0xffffff);
	cursor.rect(ctx.plan.terrain.heights, -10, -10, 30, 20, 0xffffff);
	assert.ok(cursor.root.visible);
	cursor.hide();
	lots.dispose();
	water.dispose();
	cursor.dispose();
});
