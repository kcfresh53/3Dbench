import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildModel } from '../src/core/buildings/massing';
import { bakedMesh, modularMesh, silhouetteMesh } from '../src/core/buildings/mesh';
import { packBuildings } from '../src/core/gameready/atlas';
import { planBuilding } from '../src/core/buildings/plan';
import { DISTRICT_TYPES } from '../src/core/district/library';
import { specFor } from './helpers';
import type { ShapeKind } from '../src/core/buildings/types';

const shapes: ShapeKind[] = ['rounded', 'chamfered', 'tapered', 'sail'];
test('lofted towers preserve their silhouette and finite UVs in preview and every export LOD', () => {
	for (const shape of shapes) {
		const spec = { ...specFor('office_tower', 32), shape, nx: 8, nz: 6, palette: 12 };
		const model = buildModel(spec);
		assert.deepEqual(model, buildModel(spec));
		assert.ok(model.facades.length >= 8);
		const modular = modularMesh(model), baked = bakedMesh(model, 0), coarse = silhouetteMesh(model);
		for (const mesh of [modular, baked, coarse]) {
			assert.ok(mesh.positions.every(p => p.every(Number.isFinite)));
			assert.ok(mesh.positions.every(p => Math.abs(p[0]) <= model.width / 2 + .2 && Math.abs(p[2]) <= model.depth / 2 + .2));
			assert.ok(mesh.faces.every(f => f.uvs.every(uv => uv.every(Number.isFinite))));
			assert.ok(mesh.faces.every(f => {
				const [a,b,c] = f.indices.map(i => mesh.positions[i]);
				const u = b.map((v,i) => v-a[i]), v = c.map((n,i) => n-a[i]);
				return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]) > 1e-8;
			}));
		}
		assert.ok(coarse.faces.length < baked.faces.length / 2);
		for (const roof of model.pieces.filter(p => p.tag === 'roof')) {
			const [a,b,c] = roof.corners;
			assert.ok((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]) > 0, 'upward roof');
		}
		if (shape === 'sail') {
			const heights = model.pieces.filter(p => p.tag === 'roof').flatMap(p => p.corners.map(v => v[1]));
			assert.ok(Math.max(...heights) - Math.min(...heights) > 10);
		}
		const atlas = packBuildings([{ name: shape, runs: model.facades, lods: [baked, bakedMesh(model,1), coarse] }], 512, 2, 2);
		assert.ok(atlas.buildings[0].lods.every(m => m.faces.every(f => f.uvs.every(uv => uv.every(v => v >= 0 && v <= 1)))));
	}
});

test('office zoning actually selects all four new tower families', () => {
	const district = DISTRICT_TYPES.find(d => d.key === 'office')!;
	const found = new Set<ShapeKind>();
	for (let i=0; i<200; i++) {
		const plan = planBuilding(district, `skyline-${i}`, 46, 46, { development: 1, value: .8, variants: 3, seed: 8 });
		if (plan) found.add(plan.spec.shape);
	}
	for (const shape of shapes) assert.ok(found.has(shape), shape);
});

test('rounded wall normals survive atlas packing and glTF export', async () => {
	const {partToGlb} = await import('../src/core/gameready/gltf');
	const model = buildModel({...specFor('office_tower',20),shape:'rounded',nx:8,nz:6});
	const mesh = bakedMesh(model,0);
	const wall = mesh.faces.find(f=>f.material.startsWith('facade:'))!;
	assert.ok(wall.normals && wall.normals.every(n=>Math.abs(Math.hypot(...n)-1)<1e-6));
	assert.notDeepEqual(wall.normals[0],wall.normals[1]);
	const packed = packBuildings([{name:'round',runs:model.facades,lods:[mesh]}],512,2,2).buildings[0].lods[0];
	const glb = partToGlb(packed,'round',{baseColor:'a.png'});
	const view = new DataView(glb.buffer,glb.byteOffset,glb.byteLength);
	assert.equal(view.getUint32(0,true),0x46546c67);
	assert.equal(view.getUint32(8,true),glb.length);
	const json = JSON.parse(new TextDecoder().decode(glb.subarray(20,20+view.getUint32(12,true))));
	assert.equal(json.accessors[1].type,'VEC3');
	assert.ok(json.accessors[0].count>0 && json.accessors[3].count%3===0);
});

test('lofted glass walls face outward with back-face culling enabled',()=>{
 for(const shape of shapes){
  const model=buildModel({...specFor('office_tower',32),shape,nx:8,nz:6});
  const mesh=bakedMesh(model,0);
  for(const face of mesh.faces.filter(f=>f.material.startsWith('facade:'))){
   const [a,b,c]=face.indices.map(i=>mesh.positions[i]);
   const u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]);
   const nx=u[1]*v[2]-u[2]*v[1],nz=u[0]*v[1]-u[1]*v[0];
   const cx=(a[0]+b[0]+c[0])/3,cz=(a[2]+b[2]+c[2])/3;
   assert.ok(nx*cx+nz*cz>0,`${shape}: inward-facing wall`);
  }
 }
});
