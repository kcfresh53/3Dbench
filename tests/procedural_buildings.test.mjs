import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {buildBuilding,materializeBuilding,planBuilding,normalize,STYLES,MAX_TRIANGLES,transformVertex} from '../plugins/procedural_buildings/generator.mjs';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/buildings_placements.json',import.meta.url)));
const key=e=>e.module+':'+e.transform.map(n=>Math.abs(n)<1e-4?0:Math.round(n*1000)/1000).join(',');
for(const [style,s] of Object.entries(STYLES))test(`${style}: every structural module matches the evaluated Blender example`,()=>{
 const actual=planBuilding({style,...s.defaults}).instances.map(key).sort();
 const expected=fixtures['Building '+style[1]].map(e=>key({module:e.module,transform:[e.matrix[0][0],e.matrix[0][1],e.matrix[1][0],e.matrix[1][1],e.matrix[0][3],e.matrix[1][3],e.matrix[2][3]]})).sort();
 assert.deepEqual(actual,expected);
});
test('facades, eight corner panels, cornices and roof tiles scale to rectangular dimensions',()=>{
 for(const bays_x of [2,3,7,12])for(const bays_z of [2,4,9]){
  const {instances}=planBuilding({bays_x,bays_z,floors:3,top_floors:2});
  const count=s=>instances.filter(i=>i.module.endsWith(s)).length;
  assert.equal(count('Ground floor corner'),8);
  assert.equal(count('Ground floor'),2*(bays_x+bays_z-4));
  assert.equal(count('Roof corner'),4);
  assert.equal(count('Roof middle'),(bays_x-2)*(bays_z-2));
  assert.equal(count('Roof side'),2*(bays_x+bays_z-4));
 }
});
test('input normalization bounds counts and preserves source proportions',()=>{
 const p=normalize({style:'invalid',floors:Infinity,bays_x:-1,bays_z:100,scale:NaN,seed:-5});
 assert.equal(p.style,'b1');assert.equal(p.floors,5);assert.equal(p.bays_x,2);assert.equal(p.bays_z,12);assert.equal(p.scale,1);assert.equal(p.seed,0);
 assert.deepEqual(transformVertex([1,2,3],[1,0,0,1,0,0,0]),[1,3,-2]);
});
const assetPath=new URL('../.local-assets/buildings/library.json',import.meta.url);
const library=existsSync(assetPath)?JSON.parse(readFileSync(assetPath)):null;
test('adapted source library retains all 55 modules, atlas UVs and finite normals',{skip:!library&&'Run import_building_modules.py with the supplied Blender file'},()=>{
 assert.equal(Object.keys(library.modules).length,55);assert(library.atlas.data.startsWith('data:image/png;base64,'));
 for(const [name,module] of Object.entries(library.modules)){
  assert(module.vertices.flat().every(Number.isFinite),name);
  assert.equal(module.faces.length,module.uvs.length);assert.equal(module.faces.length,module.normals.length);
  module.faces.forEach((face,i)=>{
   assert(face.length===3||face.length===4,name);assert.equal(new Set(face).size,face.length,name);
   assert(face.every(v=>v>=0&&v<module.vertices.length),name);
   assert.equal(module.uvs[i].length,face.length);assert(module.uvs[i].flat().every(v=>Number.isFinite(v)&&v>=0&&v<=1),name);
   assert(module.normals[i].flat().every(Number.isFinite),name);
  });
 }
});
test('seeded details repeat and zero amounts omit accessories',{skip:!library},()=>{
 const p={style:'b2',...STYLES.b2.defaults};
 assert.deepEqual(buildBuilding(p,library),buildBuilding(p,library));
 assert.notDeepEqual(buildBuilding({...p,seed:44},library).instances,buildBuilding({...p,seed:45},library).instances);
 assert.equal(buildBuilding({...p,extra_1:0,extra_2:0,ground_1:0,ground_2:0},library).instances.length,290);
});
test('editable output preserves triangle count, UV orientation and mirrored winding',{skip:!library},()=>{
 for(const style of Object.keys(STYLES)){
  const out=buildBuilding({style,bays_x:2,bays_z:2,floors:1,top_floors:1},library),meshes=materializeBuilding(out,library);
  assert.equal(meshes.reduce((n,m)=>n+m.faces.reduce((n,f)=>n+f.length-2,0),0),out.triangles);
  assert(meshes.every(m=>m.vertices.length<=24000));
  for(const m of meshes){assert.equal(m.uvs.length,m.faces.length);assert(m.vertices.flat().every(Number.isFinite));}
  const original=library.modules[`${STYLES[style].prefix} Ground floor corner`],first=out.instances[0];
  const part=meshes.find(m=>m.name==='Ground floor corner');
  assert(first.transform[0]*first.transform[3]-first.transform[1]*first.transform[2]<0);
  assert.deepEqual(part.faces[0],[...original.faces[0]].reverse());
  assert.deepEqual(part.uvs[0],original.uvs[0].map(([u,v])=>[u,1-v]).reverse());
 }
});
test('oversized detailed buildings fail before allocating editable meshes',{skip:!library},()=>{
 assert.throws(()=>buildBuilding({style:'b2',bays_x:12,bays_z:12,floors:12,top_floors:4,extra_2:100},library),/2 million/);
 for(const [style,s] of Object.entries(STYLES))assert(buildBuilding({style,...s.defaults},library).triangles<MAX_TRIANGLES);
});
