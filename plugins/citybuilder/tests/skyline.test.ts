import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CityState} from '../src/core/city/state';
import {generateTerrain} from '../src/core/terrain/generate';
import {zoneSkyline} from '../src/core/city/skyline';
import {composeCity} from '../src/core/city/compose';
import {buildManifest} from '../src/core/city/manifest';

test('river skyline zoning preserves existing paint and produces a dry city, woodland and wind farm',()=>{
 const state=CityState.create({cols:129,rows:129,cellSize:12,seed:8,development:1,maxTrees:12000});
 state.settings.surface.snowLine=150;
 generateTerrain(state.terrain,{preset:'river_city',seed:8});
 state.districts.grid.set(64,64,10);
 zoneSkyline(state);
 assert.equal(state.districts.grid.get(64,64),10);
 const ids=new Set(state.districts.grid.data);
 for(const id of [1,2,3,4,6,14,13])assert.ok(ids.has(id),`district ${id}`);
 assert.ok(state.terrain.heights.some(h=>h<0));
 assert.ok(state.terrain.heights.some(h=>h>35));
 const plan=composeCity(state,{corridors:[],junctions:[]});
 assert.ok(plan.buildings.length>100);
 assert.ok(plan.buildings.some(b=>b.spec.archetype==='wind_turbine'));
 const prefabs=new Map(plan.prefabs.all().map(p=>[p.key,p]));
 for(const b of plan.buildings){
  const lot=plan.lots.find(l=>l.id===b.lotId)!;
  const model=prefabs.get(b.prefab)!.model;
  assert.ok(model.width*(b.scale?.[0]??1)<=lot.width+1e-6);
  assert.ok(model.depth*(b.scale?.[2]??1)<=lot.depth+1e-6);
  assert.ok(b.y>state.settings.waterLevel);
 }
 const manifest=buildManifest(plan,state.settings,new Map(),{heightmap:'h.bin',albedo:'a.png',chunks:[]});
 assert.deepEqual(manifest.buildings[0].scale,plan.buildings[0].scale?.map(n=>Math.round(n*1000)/1000));
});

test('skyline highway is an elevated, smooth editable loop', async()=>{
 const {addSkylineRing}=await import('../src/core/city/skyline');
 const {createNetwork}=await import('../../roadscape/src/core/network');
 const state=CityState.create({cols:129,rows:129,cellSize:12});
 const network=createNetwork();addSkylineRing(state,network);
 assert.equal(network.nodes.size,16);assert.equal(network.segments.size,16);
 for(const edge of network.segments.values()){
  assert.equal(edge.structure,'bridge');assert.equal(edge.profile,'highway');assert.equal(edge.smooth,true);
 }
 for(const node of network.nodes.values())assert.ok(node.position[1]>=state.terrain.sample(node.position[0],node.position[2])+13.99);
});
