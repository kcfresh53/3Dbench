import assert from 'node:assert/strict';
import {test} from 'node:test';
import {generateLayout,DEFAULT_LAYOUT} from '../src/core/city/layout';
import {flatCity,roadsOf} from './helpers';
import {terrainStructure} from '../../roadscape/src/core/terrain_context';
import {resolveStructure} from '../../roadscape/src/core/structures';
import {buildIndex,segmentCurve,resolveProfileData} from '../../roadscape/src/core/network';
import {conformRoads,DEFAULT_CONFORM} from '../src/core/terrain/conform';
import {terrainBakePieces} from '../src/core/terrain/bake';
import {composeCity} from '../src/core/city/compose';

test('layout generation is deterministic, connected, bounded and leaves terrain untouched',()=>{
 const s=flatCity();const before=s.terrain.heights.slice();
 for(const kind of ['grid','organic','circuit'] as const){
  const options={...DEFAULT_LAYOUT,kind,rotation:45,coverage:.85};
  const a=generateLayout(s.terrain,0,2,options),b=generateLayout(s.terrain,0,2,options);
  assert.deepEqual([...a.nodes.values()],[...b.nodes.values()]);
  const reached=new Set<string>([a.nodes.keys().next().value!]);
  for(let n=0;n<a.nodes.size;n++)for(const e of a.segments.values())if(reached.has(e.a)||reached.has(e.b)){reached.add(e.a);reached.add(e.b);}
  assert.equal(reached.size,a.nodes.size);
  for(const n of a.nodes.values())assert.ok(s.terrain.containsWorld(n.position[0]/2,n.position[2]/2));
  if(kind==='circuit')assert.equal(a.nodes.size,a.segments.size);
 }
 assert.deepEqual(s.terrain.heights,before);
});

test('local gaps and water trigger bridges; automation can be disabled and explicit jump spans win',()=>{
 const points=Array.from({length:51},(_,i)=>[i*2,2,0] as [number,number,number]);
 const rules={waterLevel:0,gapHeight:10,minSpan:8,autoBridges:true};
 assert.equal(terrainStructure(points,x=>x>=40&&x<=60?-15:2,rules),'bridge');
 assert.equal(terrainStructure(points,x=>x>=40&&x<=60?-1:2,rules),'bridge');
 assert.equal(terrainStructure(points,()=>2,rules),'ground');
 assert.equal(terrainStructure(points,()=>-1,{...rules,autoBridges:false}),'ground');
 const state=flatCity(),graph=generateLayout(state.terrain,0,1,DEFAULT_LAYOUT);
 const edge=[...graph.segments.values()][0];edge.structure='air';
 const curve=segmentCurve(graph,buildIndex(graph),edge);
 assert.equal(resolveStructure(edge,resolveProfileData(graph,edge.profile),curve,graph.settings,{revision:'1',groundAt:()=>-15,autoStructure:()=> 'bridge'}),'air');
 const roads=roadsOf(graph,state);const target=roads.corridors.find(r=>r.id===edge.key)!;
 assert.equal(target.structure,'air');
 assert.deepEqual(conformRoads(state.terrain,[target],DEFAULT_CONFORM).heights.heights,state.terrain.heights);
});

test('road shoulders ease over several terrain cells without changing authored road heights',()=>{
 const state=flatCity();const graph=generateLayout(state.terrain,0,1,{...DEFAULT_LAYOUT,kind:'grid'});
 const road=roadsOf(graph,state).corridors[0];road.points.forEach(p=>p.y=5);
 const source=JSON.stringify(road.points);
 const result=conformRoads(state.terrain,[road],{...DEFAULT_CONFORM,roadBlend:24});
 assert.ok(result.roadWeight.some(w=>w>0&&w<1));
 assert.equal(JSON.stringify(road.points),source);
 assert.ok(result.heights.heights.every(h=>h>=2&&h<=5));
});

test('chunked bake retains detail and pads UV borders; single map remains available',()=>{
 const state=flatCity();state.settings.terrainTexture=512;
 const plan=composeCity(state,{corridors:[],junctions:[]});
 const pieces=[...terrainBakePieces(plan,state.settings)];
 assert.equal(pieces.length,16);assert.equal(new Set(pieces.map(p=>p.texture)).size,16);
 for(const p of pieces)assert.ok(p.patch.uvs.every(uv=>uv>0&&uv<1));
 state.settings.terrainTextureMode='single';
 const shared=[...terrainBakePieces(plan,state.settings)];
 assert.equal(new Set(shared.map(p=>p.raster)).size,1);
});
