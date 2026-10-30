import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openSync,readSync,closeSync } from 'node:fs';
import { MATERIAL_IDS,materialInfo,materialSource } from '../src/texture/material_resources';
import { materialPlate,sampleMaterial } from '../src/texture/ambientcg';
import { composeCity } from '../src/core/city/compose';
import { CityState } from '../src/core/city/state';
import { buildGamePackage } from '../src/core/gameready/package';
import { terrainLayers } from '../src/core/terrain/layers';
import { paintTerrain } from '../src/core/terrain/paint';
import { foundationMesh } from '../src/core/buildings/foundations';
import { specFor, flatCity, crossroadNetwork, roadsOf } from './helpers';
import { conformLots,conformRoads,DEFAULT_CONFORM } from '../src/core/terrain/conform';
import { Heightfield } from '../src/core/terrain/heightfield';
import type { Lot } from '../src/core/lots/types';
import { sampleStochastic } from '../src/texture/stochastic';
import { Raster } from '../src/core/raster';
import { dataRasterPng } from '../src/core/raster_png';
import { inflateSync } from 'node:zlib';
import { SURFACES } from '../src/core/terrain/surfaces';

test('every bundled material retains its actual 4K JPEG dimensions, including non-square bricks',()=>{
	for(const id of MATERIAL_IDS)for(const channel of ['albedo','normal','orm'] as const) {
		const file=openSync(materialSource(id,channel),'r'), header=Buffer.alloc(65536);
		try{readSync(file,header,0,header.length,0);}finally{closeSync(file);}
		assert.equal(header.readUInt16BE(0),0xffd8);
		let p=2, dimensions:number[]=[];
		while(p<header.length-9) {
			assert.equal(header[p],255);const marker=header[p+1],size=header.readUInt16BE(p+2);
			if([0xc0,0xc1,0xc2].includes(marker)){dimensions=[header.readUInt16BE(p+7),header.readUInt16BE(p+5)];break;}
			p+=size+2;
		}
		assert.deepEqual(dimensions,[materialInfo(id).width,materialInfo(id).height]);
		assert.equal(dimensions[0],4096);
	}
	assert.equal(materialInfo('rock').asset,'Rock037');
	assert.equal(materialInfo('brick').height,2048);
	assert.equal(materialInfo('facade_a').asset,'Facade018A','the black night facade is replaced in the shared PBR library');
});

test('periodic PBR sampling has matching negative-coordinate seams and filtered distant mips',()=>{
	for(const channel of ['albedo','normal','orm'] as const){
		const a=new Float64Array(3),b=new Float64Array(3),m=materialInfo('sand').metres;
		sampleMaterial('sand',channel,-.17,-.29,a);sampleMaterial('sand',channel,-.17+m[0],-.29+m[1],b);
		for(let k=0;k<3;k++)assert.ok(Math.abs(a[k]-b[k])<1e-6);
		assert.ok(materialPlate('sand',channel,1).w<materialPlate('sand',channel).w);
	}
});

test('stochastic terrain breaks source repeats, stays continuous and inverse-rotates unit normals',()=>{
	const plate=materialPlate('grass','albedo'),a=new Float64Array(3),b=new Float64Array(3),c=new Float64Array(3);
	sampleStochastic(plate,.23,.61,'albedo',a,17);sampleStochastic(plate,1.23,.61,'albedo',b,17);
	assert.ok(a.some((n,i)=>Math.abs(n-b[i])>2),'adjacent source repeats are decorrelated');
	// Cross both a triangle diagonal and a negative-coordinate cell boundary.
	for(const [u,v] of [[.933333333333,.692820323027],[-.01,-.01],[0,0]]) {
		sampleStochastic(plate,u-1e-7,v,'albedo',a,17);sampleStochastic(plate,u+1e-7,v,'albedo',b,17);
		assert.ok(a.every((n,i)=>Math.abs(n-b[i])<.1),'stochastic mapping has no hard seams');
	}
	const normal={w:8,h:8,c:3,data:new Uint8Array(8*8*3)};
	for(let i=0;i<64;i++)normal.data.set([200,128,235],i*3);
	sampleStochastic(normal,.23,.61,'normal',a,17);
	assert.ok(Math.abs(Math.hypot(...a.map(n=>n/127.5-1))-1)<1e-6);
	sampleStochastic(normal,0,0,'normal',a,0);
	assert.ok(a[1]/127.5-1>.5&&Math.abs(a[0]/127.5-1)<.02,'normal XY is inverse-rotated with the source sample');
	sampleStochastic(plate,.23,.61,'albedo',b,17);sampleStochastic(plate,.23,.61,'albedo',c,17);assert.deepEqual(b,c);
});

test('packed RGBA masks survive PNG export even when alpha is zero',()=>{
	const raster=new Raster(2,1);raster.data.set([255,0,0,0,17,23,41,9]);
	const png=dataRasterPng(raster);let p=8,compressed:Uint8Array|undefined;
	while(p<png.length){const n=new DataView(png.buffer,p).getUint32(0);if(new TextDecoder().decode(png.subarray(p+4,p+8))==='IDAT')compressed=png.subarray(p+8,p+8+n);p+=n+12;}
	assert.deepEqual([...inflateSync(compressed!)],[0,...raster.data]);
});

function smallCity(){
	const state=CityState.create({cols:17,rows:17,cellSize:4,terrainTexture:512,features:{buildings:false,trees:false}});
	state.terrain.heights.fill(3);state.paint.data.forEach((_,i)=>state.paint.data[i]=i%10+1);
	return {state,plan:composeCity(state,{corridors:[],junctions:[]})};
}

test('building pad support preserves painted ground in live layers and baked PBR maps',()=>{
	const {state,plan}=smallCity();
	plan.surfaces.data.fill(1);
	plan.terrain.roadWeight.fill(0);
	plan.terrain.lotWeight.fill(1);
	const layers=terrainLayers(plan,state.settings);
	const paving=layers.manifest.entries.find(e=>e.surface==='paved')!;
	assert.ok(layers.files[paving.mask].raster.data.every((w,i)=>i%4!==paving.channel||w===0),'automatic pads add no paving');
	const input={hf:plan.terrain.heights,surfaces:plan.surfaces,waterLevel:0,size:32,seed:1,sun:[0,1,0] as [number,number,number]};
	for(const channel of ['albedo','normal','orm'] as const)assert.deepEqual(
		paintTerrain({...input,channel,lotWeight:plan.terrain.lotWeight,padColor:[136,146,118]}).data,
		paintTerrain({...input,channel}).data,'pad support retains the original '+channel);
	plan.surfaces.data.fill(SURFACES.indexOf('paved')+1);
	const painted=terrainLayers(plan,state.settings);
	assert.ok(painted.files[paving.mask].raster.data.every((w,i)=>i%4!==paving.channel||w===255),'deliberately painted paving remains available');
});

test('road grading supports shoulders without painting asphalt into adjoining yards',()=>{
	const state=flatCity();
	const roads=roadsOf(crossroadNetwork(60),state);
	const result=conformRoads(state.terrain,[roads.corridors[0]],DEFAULT_CONFORM);
	const index=(x:number,z:number)=>state.terrain.index(state.terrain.colAt(x),state.terrain.rowAt(z));
	assert.ok(result.roadWeight[index(12,-30)]>.6,'shoulder retains structural grading');
	assert.equal(result.roadbedWeight[index(12,-30)],0,'shoulder retains its painted ground');
	assert.equal(result.roadbedWeight[index(0,-30)],1,'carriageway retains roadbed coverage');
});

test('terrain exports wire PBR maps into glTF and retain normalized engine blend masks and 4K resources',()=>{
	const {state,plan}=smallCity(),pkg=buildGamePackage(plan,state),paths=new Set(pkg.files.map(f=>f.path));
	const chunk=pkg.files.find(f=>f.path===pkg.manifest.terrain.chunks[0])!.bytes!;
	const json=JSON.parse(new TextDecoder().decode(chunk.subarray(20,20+new DataView(chunk.buffer).getUint32(12,true))));
	assert.ok(json.materials[0].normalTexture&&json.materials[0].occlusionTexture&&json.materials[0].pbrMetallicRoughness.metallicRoughnessTexture);
	for(const image of json.images)assert.ok(paths.has('terrain/'+image.uri));
	for(const material of pkg.manifest.materials!)for(const path of [material.albedo,material.normal,material.orm])assert.ok(path&&paths.has(path));
	const layers=terrainLayers(plan,state.settings);
	for(let i=0;i<layers.files[0].raster.width*layers.files[0].raster.height;i++) {
		const sum=layers.manifest.entries.reduce((s,e)=>s+layers.files[e.mask].raster.data[i*4+e.channel],0);
		assert.equal(sum,255,'layer masks form a partition of unity');
	}
	const input={hf:plan.terrain.heights,surfaces:plan.surfaces,waterLevel:0,size:32,seed:1,sun:[0,1,0] as [number,number,number]};
	assert.deepEqual(paintTerrain(input).data,paintTerrain({...input,sun:[1,0,0]}).data,'directional light is not baked into PBR albedo');
});

test('a sub-cell building pad is supported and foundations extend below every underlying triangle',()=>{
	const hf=new Heightfield({cols:17,rows:17,cellSize:8});
	for(let r=0;r<hf.rows;r++)for(let c=0;c<hf.cols;c++)hf.set(c,r,hf.worldX(c)*.15+hf.worldZ(r)*.1);
	const lot:Lot={id:'tiny',roadId:'',side:'left',obb:{cx:3,cz:3,hw:1,hd:1,ux:1,uz:0},width:2,depth:2,districtId:1,padHeight:4,relief:2,roadLanes:0,roadDistance:0,value:1};
	const result=conformLots(conformRoads(hf,[],DEFAULT_CONFORM),[lot],DEFAULT_CONFORM);
	for(const x of [2,3,4])for(const z of [2,3,4])assert.ok(Math.abs(result.heights.sample(x,z)-4)<1e-5);
	const building={lotId:'tiny',districtId:1,x:3,y:4,z:3,yaw:.45,width:2,depth:2,spec:specFor('house',2),prefab:'test'};
	const foundation=foundationMesh([building],hf);
	assert.equal(foundation.faces.length,5);
	for(const p of foundation.positions.slice(4))assert.ok(p[1]<hf.sample(p[0],p[2]));
});
