import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {layoutGrid} from '../plugins/procedural_buildings/layout.mjs';
import {nativeOutput} from '../plugins/procedural_buildings/flexi-native.mjs';
// Watertight unit voxels model the same topology as box loop cuts and face extrusions.
export function cage(voxels,scale=4){
 const occupied=new Set(voxels.map(v=>v.join(','))),vertices={},faces=[];
 const sides=[[[1,0,0],[[1,0,0],[1,1,0],[1,1,1],[1,0,1]]],[[-1,0,0],[[0,1,0],[0,0,0],[0,0,1],[0,1,1]]],[[0,1,0],[[1,1,0],[0,1,0],[0,1,1],[1,1,1]]],[[0,-1,0],[[0,0,0],[1,0,0],[1,0,1],[0,0,1]]],[[0,0,1],[[0,0,1],[1,0,1],[1,1,1],[0,1,1]]],[[0,0,-1],[[0,1,0],[1,1,0],[1,0,0],[0,0,0]]]];
 for(const v of voxels)for(const [normal,corners] of sides){if(occupied.has(v.map((n,i)=>n+normal[i]).join(',')))continue;faces.push(corners.map(c=>{const p=c.map((n,i)=>(n+v[i])*scale),key=p.join(',');vertices[key]=p;return key;}));}
 return {vertices,faces};
}
const solid=(w,d,h,predicate=()=>true)=>Array.from({length:w*d*h},(_,i)=>[i%w,Math.floor(i/w)%d,Math.floor(i/(w*d))]).filter(predicate);
const volume=grid=>grid.heights.reduce((sum,col,x)=>sum+col.reduce((s,h,y)=>s+(h===null?0:(h-grid.base)*(grid.xs[x+1]-grid.xs[x])*(grid.ys[y+1]-grid.ys[y])),0),0);
test('loop cuts preserve the same footprint and facade seams as an uncut box',()=>{
 const a=layoutGrid(cage(solid(4,3,3)),6),b=layoutGrid(cage([[0,0,0]],12),6);
 assert.deepEqual(a.xs,[0,16/3,32/3,16]);assert.deepEqual(a.ys,b.ys);
 assert.ok(Math.abs(volume(a)-4*3*3*64)<1e-7);
 const box=cage(solid(3,3,3));assert.deepEqual(layoutGrid(box,6),b);
});
test('extruded L wings, courtyard holes and stepped roofs retain their actual volume',()=>{
 for(const voxels of [solid(4,4,3,([x,y])=>x<2||y<2),solid(4,4,3,([x,y])=>x===0||y===0||x===3||y===3),solid(4,4,4,([x,y,z])=>x<2||z<2)]){
  const grid=layoutGrid(cage(voxels),4);assert.ok(Math.abs(volume(grid)-voxels.length*64)<1e-7);
 }
});
test('open cages, sloping faces and stacked cavities fail with actionable errors',()=>{
 const open=cage([[0,0,0]]);open.faces.pop();assert.throws(()=>layoutGrid(open,4),/Close/);
 const slope=cage([[0,0,0]]);Object.values(slope.vertices)[0][0]+=.5;assert.throws(()=>layoutGrid(slope,4),/axis-aligned/);
 assert.throws(()=>layoutGrid(cage([[0,0,0],[0,0,2]]),4),/cavities/);
});
test('all styles wrap a stepped mesh with finite source transforms and exact roof elevations',{skip:!existsSync(new URL('../.local-assets/flexibuilding/native/style1.json',import.meta.url))},()=>{
 const layout=cage(solid(4,3,4,([x,y,z])=>x<2||z<2));
 for(let style=1;style<=10;style++){
  const library=JSON.parse(readFileSync(new URL(`../.local-assets/flexibuilding/native/style${style}.json`,import.meta.url)));
  const output=nativeOutput({shape:'mesh',layout,style,module_size:1,roof_amount:0,ac:0,tanks:0,antennas:0},library);
  assert.ok(output.triangles>0);assert.ok(output.bounds.min.every(Number.isFinite));
  assert.deepEqual([...new Set(output.instances.filter(e=>e.module.endsWith('.Roof')).map(e=>e.transform[11]))].sort((a,b)=>a-b),[8,16]);
  for(const entry of output.instances)assert.ok(entry.transform.every(Number.isFinite));
 }
});

test('extreme layouts fail before allocating roof cells',()=>{assert.throws(()=>layoutGrid(cage([[0,0,0]],1e8),4),/Increase module size/);});
