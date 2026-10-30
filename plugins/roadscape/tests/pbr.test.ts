import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadLibrary } from './fixtures';
import { network,crossroad,FakeTrees } from './helpers';
import { generateNetwork,GenerationCache } from '../src/core/generate';
import { pbrRoadParts } from '../src/core/pbr_materials';
import { resolveProfileData } from '../src/core/network';
import { polygonNormal } from '../src/core/part_set';

test('full-resolution road surfaces preserve geometry, markings and local tile UVs',()=>{
	const library=loadLibrary(), n=network('street',[['a',[0,2,0]],['b',[80,2,0]]],[['a','b']]);
	const original=generateNetwork(n,{library,trees:new FakeTrees()}).parts;
	const snapshot=JSON.stringify(original),parts=pbrRoadParts(original,library);
	assert.equal(JSON.stringify(original),snapshot,'cached atlas geometry is not mutated');
	assert.equal(parts.reduce((n,p)=>n+p.faces.length,0),original.reduce((n,p)=>n+p.faces.length,0));
	assert.ok(parts.some(p=>p.atlas==='pbr:asphalt'));
	assert.ok(parts.some(p=>p.atlas==='pbr:concrete'),'gutters use the selected concrete');
	assert.ok(parts.every(p=>p.atlas!=='pbr:paved'),'street edges do not acquire decorative pavers');
	assert.ok(parts.some(p=>p.atlas==='road'),'painted markings and props retain their existing artwork');
	const retained=new Set(parts.filter(p=>p.atlas==='road').flatMap(p=>p.faces.map(f=>JSON.stringify(f.uvs))));
	for(const name of ['Sidewalk Curb 1','Sidewalk A']) {
		const [cu,cv,cs]=library.materials[name].tile;
		const faces=original.flatMap(p=>p.faces.filter(f=>p.atlas==='road'&&f.uvs.every(([u,v])=>u>=cu-1e-7&&v>=cv-1e-7&&u<=cu+cs+1e-7&&v<=cv+cs+1e-7)));
		assert.ok(faces.length>0,'test street includes '+name);
		assert.ok(faces.every(f=>retained.has(JSON.stringify(f.uvs))),name+' retains its original atlas artwork and UVs');
	}
	for(const part of parts)for(const f of part.faces)for(const uv of f.uvs)assert.ok(uv.every(v=>Number.isFinite(v)&&v>=-1e-6),'local repeat UVs stay finite and preserve physical texel density');
});

test('terrain contact seals the complete curved junction and cap perimeter and follows terrain edits',()=>{
	const library=loadLibrary(),n=crossroad('street',60),cache=new GenerationCache();
	// Coplanar road and sidewalk tops let us independently measure the complete external
	// boundary, including fillets and caps, without counting internal curb risers.
	const profile=structuredClone(resolveProfileData(n,'street'));
	profile.id='flat-sidewalk';profile.carriageway.crown=0;
	profile.left=profile.left.filter(e=>e.kind==='strip'&&e.type==='sidewalk');
	profile.right=profile.right.filter(e=>e.kind==='strip'&&e.type==='sidewalk');
	for(const e of [...profile.left,...profile.right])if(e.kind==='strip')e.top=0;
	n.profiles.set(profile.id,profile);
	for(const s of n.segments.values())s.profile=profile.id;
	for(const node of n.nodes.values())node.position[1]=2;
	const terrain={revision:'one',groundAt:()=>0,surfaceAt:(x:number,z:number)=>.5+.06*Math.sin(x*.3)*Math.cos(z*.27),autoStructure:()=>'ground' as const};
	const result=generateNetwork(n,{library,trees:new FakeTrees(),terrain},cache);
	const key=(p:number[])=>p.map(v=>Math.round(v*1e4)).join(',');
	const edge=(a:number[],b:number[])=>[key(a),key(b)].sort().join('|');
	const boundary=new Map<string,number>();
	for(const part of result.parts.filter(p=>['Road surface','Sidewalk'].includes(p.name)))for(const f of part.faces) {
		const points=f.indices.map(i=>part.positions[i]);
		if(polygonNormal(points)[1]<=0)continue;
		for(let i=0;i<points.length;i++){const k=edge(points[i],points[(i+1)%points.length]);boundary.set(k,(boundary.get(k)??0)+1);}
	}
	const edges=[...boundary].filter(([,count])=>count===1).map(([k])=>({key:k,points:k.split('|').map(p=>p.split(',').map(Number))}));
	// A cap's triangle fan splits its mouth at the centre, whereas the ribbon has one
	// edge across that mouth. Remove those overlapping internal edges before comparing.
	const expected=edges.filter((e,index)=>!edges.some((other,j)=>{
		if(index===j)return false;
		const [a,b]=e.points,[c,d]=other.points,dx=b[0]-a[0],dz=b[2]-a[2],length2=dx*dx+dz*dz;
		if(Math.abs((c[0]-a[0])*dz-(c[2]-a[2])*dx)>.5*Math.sqrt(length2)||Math.abs((d[0]-a[0])*dz-(d[2]-a[2])*dx)>.5*Math.sqrt(length2))return false;
		const t0=((c[0]-a[0])*dx+(c[2]-a[2])*dz)/length2,t1=((d[0]-a[0])*dx+(d[2]-a[2])*dz)/length2;
		return Math.min(1,Math.max(t0,t1))-Math.max(0,Math.min(t0,t1))>1e-6;
	})).map(e=>e.key);
	const contact=result.parts.find(p=>p.name==='Ground road contact')!;
	assert.ok(contact.positions.every(p=>Math.abs(p[1]-1.995)<1e-6||Math.abs(p[1]-terrain.surfaceAt(p[0],p[2])-.005)<1e-6),'curved contact samples the actual uneven terrain');
	const joined=new Set<string>();
	for(const f of contact.faces) {
		const top=f.indices.map(i=>contact.positions[i]).filter(p=>Math.abs(p[1]-1.995)<1e-6);
		assert.equal(top.length,2);
		joined.add(edge(...top.map(p=>[p[0],2,p[2]]) as [number[],number[]]));
	}
	assert.ok(expected.length>40,'test covers rounded intersection corners and dead ends');
	// Contact edges may be subdivided further to follow terrain between road vertices.
	// Compare their geometric coverage in both directions, independent of tessellation.
	const actual=[...joined];
	for(const [from,to] of [[expected,actual],[actual,expected]])for(const k of from) {
		const [a,b]=k.split('|').map(p=>p.split(',').map(Number)),dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);
		let covered=0;
		for(const q of to) {
			const [c,d]=q.split('|').map(p=>p.split(',').map(Number));
			if(Math.abs((c[0]-a[0])*dz-(c[2]-a[2])*dx)>1.5*length||Math.abs((d[0]-a[0])*dz-(d[2]-a[2])*dx)>1.5*length)continue;
			const t0=((c[0]-a[0])*dx+(c[2]-a[2])*dz)/length,t1=((d[0]-a[0])*dx+(d[2]-a[2])*dz)/length;
			covered+=Math.max(0,Math.min(length,Math.max(t0,t1))-Math.max(0,Math.min(t0,t1)));
		}
		assert.ok(Math.abs(covered-length)<3,'complete perimeter contact, including curved corners: '+k);
	}
	const changed=generateNetwork(n,{library,trees:new FakeTrees(),terrain:{...terrain,revision:'two',surfaceAt:()=>.8}},cache);
	assert.ok(changed.parts.find(p=>p.name==='Ground road contact')!.positions.every(p=>Math.abs(p[1]-1.995)<1e-6||Math.abs(p[1]-.805)<1e-6),'junction contacts rebuild when terrain changes');
});

test('contact shoulders meet final terrain only on ground roads, preserving intentional open spans',()=>{
	const library=loadLibrary(), n=network('street',[['a',[0,2,0]],['b',[80,2,0]]],[['a','b']]);
	const terrain={revision:'test',groundAt:()=>0,surfaceAt:()=>1.88,autoStructure:()=>'ground' as const};
	for(const structure of ['ground','bridge','tunnel','air'] as const) {
		for(const segment of n.segments.values())segment.structure=structure;
		const parts=generateNetwork(n,{library,trees:new FakeTrees(),terrain}).parts;
		const contact=parts.find(p=>p.name==='Ground road contact');
		assert.equal(!!contact,structure==='ground');
		if(contact)assert.ok(contact.positions.some(p=>Math.abs(p[1]-1.885)<1e-5));
	}
});
