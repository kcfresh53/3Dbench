import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformVertex,transformDeterminant,materializeBuilding} from '../plugins/procedural_buildings/generator.mjs';
const manifest=JSON.parse(readFileSync(new URL('../plugins/procedural_buildings/flexi-manifest.json',import.meta.url)));
test('source manifest includes five presets for each of ten styles and valid original controls',()=>{
 assert.equal(Object.keys(manifest.presets).length,50);
 for(let style=1;style<=10;style++)for(let variant=1;variant<=5;variant++){
  const p=manifest.presets[`Building_${style}-${variant}`];assert.equal(p.inputs.Socket_1,`Building ${style}`);
  assert.ok(p.inputs.Socket_20>=1&&p.inputs.Socket_20<=5);
 }
 const ids=manifest.controls.map(c=>c.id);assert.equal(new Set(ids).size,ids.length);
});
test('full source instance matrices preserve scale, rotation, reflection and UV winding',()=>{
 const matrix=[0,-2,0,10,-3,0,0,20,0,0,4,30,0,0,0,1];
 assert.deepEqual(transformVertex([1,2,3],matrix),[6,42,-17]);assert.equal(transformDeterminant(matrix),-24);
 const source={vertices:[[0,0,0],[1,0,0],[0,1,0]],faces:[[0,1,2]],uvs:[[[0,0],[1,0],[0,1]]]};
 const result=materializeBuilding({params:{scale:1},instances:[{module:'test',transform:matrix}]},{modules:{test:source}});
 assert.deepEqual(result[0].faces[0],[2,1,0]);assert.deepEqual(result[0].uvs[0],[[0,0],[1,1],[0,1]]);
});

import {nativePlan,nativeOutput} from '../plugins/procedural_buildings/flexi-native.mjs';
import {existsSync} from 'node:fs';
const nativePath=new URL('../.local-assets/flexibuilding/native/',import.meta.url);
const counts=JSON.parse(readFileSync(new URL('./fixtures/flexibuilding_counts.json',import.meta.url)));
for(let style=1;style<=10;style++)test(`native style ${style}: every preset preserves the original evaluated triangle count`,{skip:!existsSync(new URL(`style${style}.json`,nativePath))},()=>{
 const library=JSON.parse(readFileSync(new URL(`style${style}.json`,nativePath)));
 for(let preset=1;preset<=5;preset++){
  const output=nativeOutput({style,preset},library);
  assert.equal(output.triangles,counts.find(c=>c.name===`Building_${style}-${preset}`).triangles);
  assert.ok(output.bounds.max.every(Number.isFinite));
 }
 for(const shape of ['rectangle','l','u','courtyard']){
  const p={style,shape,width:6,depth:6,floors:4,roof_amount:0,ac:0,tanks:0,antennas:0};
  const output=nativeOutput(p,library);assert.ok(output.triangles>100);assert.ok(output.instances.some(e=>e.module.endsWith('.Roof')));
  assert.deepEqual(nativePlan(p,library),nativePlan(p,library));
 }
});

test('native preset facade overrides add source stairs and omit them when disabled',{skip:!existsSync(new URL('style1.json',nativePath))},()=>{
 const library=JSON.parse(readFileSync(new URL('style1.json',nativePath)));
 const on=nativePlan({stairs:'front'},library),off=nativePlan({stairs:'none'},library);
 assert.ok(on.instances.some(i=>i.module==='Stairs Middle Stair'));assert.ok(!off.instances.some(i=>i.module.startsWith('Stairs ')));
 const plain=nativePlan({shape:'l',plain:'all',roof_amount:0,ac:0,tanks:0,antennas:0},library);
 assert.ok(plain.instances.filter(i=>/\.(GF|Floor|RoofE)\./.test(i.module)).every(i=>i.module.startsWith('M-Plain.')));
});
test('bundled runtime has no external process, filesystem, or Blender-path dependency',()=>{
 const runtime=readFileSync(new URL('../plugins/procedural_buildings/flexi.js',import.meta.url),'utf8')+readFileSync(new URL('../plugins/procedural_buildings/flexi-assets.js',import.meta.url),'utf8');
 assert.doesNotMatch(runtime,/child_process|require\(|FlexiBuilding\.blend|\.py['"]|FLEXI_DEFAULT/);
});
