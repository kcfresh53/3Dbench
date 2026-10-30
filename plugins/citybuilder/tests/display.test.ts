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
	const geometries = new Set<THREE_NS.BufferGeometry>();
	view.root.traverse(o=>{const mesh=o as THREE_NS.Mesh;if(mesh.geometry)geometries.add(mesh.geometry);});
	assert.equal([...geometries].reduce((n,g)=>n+(g.index?.count??0)/3,0),(hf.cols-1)*(hf.rows-1)*2,'PBR layers share the terrain geometry');
	assert.ok(countTriangles(view.root)>=(hf.cols-1)*(hf.rows-1)*2);
	const first = view.root.children[0] as THREE_NS.Mesh;
	const depth = view.root.getObjectByName('City terrain depth') as THREE_NS.Mesh;
	assert.ok(depth?.visible, 'solid terrain contributes depth before transparent surfaces');
	assert.equal(depth.geometry, first.geometry, 'terrain depth shares the live terrain geometry');
	const depthMaterial = depth.material as THREE_NS.Material;
	assert.equal(depthMaterial.transparent, false);
	assert.equal(depthMaterial.colorWrite, false, 'depth pass leaves the PBR colours intact');
	assert.equal(depthMaterial.depthWrite, true);
	const before = (first.geometry.getAttribute('position') as THREE_NS.BufferAttribute).getY(5);
	hf.heights.fill(50);
	view.liveEdit(hf, { c0: 0, r0: 0, c1: hf.cols, r1: hf.rows });
	const after = (first.geometry.getAttribute('position') as THREE_NS.BufferAttribute).getY(5);
	assert.notEqual(before, after);
	assert.equal(after, 50);
	assert.equal(depth.geometry.getAttribute('position').getY(5), 50, 'occlusion follows sculpting');
	view.showOverlay(true);
	assert.ok(view.root.children.some((c) => c.visible));
	view.dispose();
	assert.equal(view.root.children.length, 0);
});

test('terrain texture bakes in the background, shows a preview first, and is not redone for unchanged ground', async () => {
	const g = globalThis as unknown as { Canvas?: object; Preview?: { all: Array<{ canvas: { isConnected: boolean; offsetParent: object }; render: () => void }> } };
	let redraws = 0;
	g.Canvas = {};
	g.Preview = { all: [{ canvas: { isConnected: true, offsetParent: {} }, render: (): void => void redraws++ }] };
	const ctx = context();
	const view = new TerrainView();
	view.rebuild(ctx);
	assert.ok(view.textureSize > 0 && view.textureSize < 2048, 'a small preview is shown at once');
	const started = Date.now();
	while (view.textureSize < 2048 && Date.now() - started < 20000) await new Promise<void>((resolve) => setTimeout(resolve, 20));
	assert.equal(view.textureSize, 2048);
	assert.ok(redraws > 0);
	const swapped = redraws;
	view.rebuild(ctx);
	await new Promise<void>((resolve) => setTimeout(resolve, 100));
	assert.equal(redraws, swapped, 'same inputs start no new bake');
	assert.equal(view.textureSize, 2048);
	view.dispose();
	delete g.Canvas;
	delete g.Preview;
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
	const g = globalThis as unknown as Record<string, unknown>;
	const saved = { raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
	// The preview animates through requestAnimationFrame, which a node test does not have.
	g.requestAnimationFrame = (): number => 1;
	g.cancelAnimationFrame = (): void => {};
	water.rebuild(ctx);
	assert.equal(water.root.children.length, 1);
	const terrain = new TerrainView();
	terrain.rebuild(ctx);
	const waterOrder = water.root.children[0].renderOrder;
	const layers = terrain.root.children.filter(o => ((o as THREE_NS.Mesh).material as THREE_NS.Material).transparent);
	assert.ok(layers.filter(o => o.visible).every(o => o.renderOrder < waterOrder), 'all PBR layers finish before water, including submerged terrain');
	terrain.showOverlay(true);
	const overlays = layers.filter(o => o.renderOrder > waterOrder);
	assert.ok(overlays.length > 0 && overlays.every(o => o.visible), 'district editing remains visible over water');
	assert.equal((water.root as unknown as { no_export: boolean }).no_export, true, 'the water sheet is never exported');
	assert.equal((water.root.children[0] as unknown as { no_export: boolean }).no_export, true);
	water.configure({ ...ctx.state.settings.water, show: false });
	assert.equal(water.root.visible, false, 'water can be hidden');
	const cursor = new CursorView();
	cursor.brush(ctx.plan.terrain.heights, 0, 0, 20, 'round', 0xffffff);
	cursor.rect(ctx.plan.terrain.heights, -10, -10, 30, 20, 0xffffff);
	assert.ok(cursor.root.visible);
	cursor.hide();
	lots.dispose();
	water.dispose();
	terrain.dispose();
	g.requestAnimationFrame = saved.raf;
	g.cancelAnimationFrame = saved.caf;
	cursor.dispose();
});

test('daylight owns its sky and shadow resources and restores renderer preferences', async () => {
 const {LightingView}=await import('../src/editor/display/lighting_view');
 const previous=(globalThis as any).Preview;
 const renderer={shadowMap:{enabled:false,type:THREE_NS.BasicShadowMap},outputEncoding:THREE_NS.LinearEncoding,toneMapping:THREE_NS.NoToneMapping,toneMappingExposure:1.25};
 (globalThis as any).Preview={all:[{renderer}]};
 const view=new LightingView();
 try {
  view.rebuild(context());
  assert.equal(renderer.shadowMap.enabled,true);
  assert.equal(renderer.outputEncoding,THREE_NS.sRGBEncoding);
  assert.equal(renderer.toneMapping,THREE_NS.ACESFilmicToneMapping);
  assert.ok(view.root.children.some(o=>(o as THREE_NS.DirectionalLight).isDirectionalLight));
  view.setEnabled(false);assert.equal(renderer.shadowMap.enabled,false);
  view.setEnabled(true);assert.equal(renderer.shadowMap.enabled,true);
  view.dispose();
  assert.equal(renderer.shadowMap.enabled,false);
  assert.equal(renderer.shadowMap.type,THREE_NS.BasicShadowMap);
  assert.equal(renderer.outputEncoding,THREE_NS.LinearEncoding);
  assert.equal(renderer.toneMapping,THREE_NS.NoToneMapping);
  assert.equal(renderer.toneMappingExposure,1.25);
  assert.equal(view.root.children.length,0);
 }finally{view.dispose();if(previous)(globalThis as any).Preview=previous;else delete (globalThis as any).Preview;}
});
