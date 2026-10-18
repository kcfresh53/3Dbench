import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const dir = await mkdtemp(path.join(tmpdir(), '3dbench-humanoid-'));
after(() => rm(dir, { recursive: true, force: true }));
for (const name of ['humanoid_builder', 'humanoid_types', 'bone_names', 'template', 'modular']) {
 await build({ entryPoints: [`js/modeling/rig/humanoid/${name}.ts`], bundle: true, platform: 'node', format: 'esm', outfile: path.join(dir, `${name}.mjs`) });
}
const { buildHumanoid } = await import(pathToFileURL(path.join(dir, 'humanoid_builder.mjs')));
const { DEFAULT_HUMANOID, HUMANOID_PRESETS } = await import(pathToFileURL(path.join(dir, 'humanoid_types.mjs')));
const { boneName } = await import(pathToFileURL(path.join(dir, 'bone_names.mjs')));
function validate(output, params) {
 const ids = new Set();
 for (const b of output.bones) {
  assert(!ids.has(b.id), `duplicate bone ${b.id}`);
  assert(!b.parent || ids.has(b.parent), `parent order ${b.id}`);
  assert(b.head.concat(b.tail).every(Number.isFinite));
  assert(Math.hypot(...b.head.map((x,i)=>x-b.tail[i]))>0);
  ids.add(b.id);
 }
 for(const convention of ['simple','unity','godot','mixamo']) assert.equal(new Set([...ids].map(id=>boneName(id,convention))).size,ids.size);
 for (const m of output.meshes) {
  assert.equal(m.vertices.length, m.vertex_weights.length);
  assert(m.vertices.flat().every(Number.isFinite));
  for(const w of m.vertex_weights) {
   assert(Math.abs(Object.values(w).reduce((a,b)=>a+b,0)-1)<1e-8);
   assert(Object.entries(w).every(([id,w])=>ids.has(id)&&w>=0&&w<=1));
   assert(Object.keys(w).length<=4);
  }
  const edges = new Map(), neighbors=m.vertices.map(()=>new Set());
  for(const f of m.faces) {
   assert(f.length===3||f.length===4);
   assert.equal(new Set(f).size,f.length);
   assert(f.every(i=>Number.isInteger(i)&&i>=0&&i<m.vertices.length));
   const a=m.vertices[f[0]],b=m.vertices[f[1]],c=m.vertices[f[2]];
   const u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]);
   assert(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])>1e-10,'degenerate face');
   for(let i=0;i<f.length;i++) {
    const a=f[i],b=f[(i+1)%f.length], key=[a,b].sort((a,b)=>a-b).join(':');
    const edge=edges.get(key)||{count:0,direction:0};edge.count++;edge.direction+=a<b?1:-1;edges.set(key,edge);
    neighbors[a].add(b);neighbors[b].add(a);
   }
  }
  assert([...edges.values()].every(e=>e.count===2&&e.direction===0),'closed, manifold, consistent winding');
  if(params.style!=='blocky') {
   const seen=new Set([0]),queue=[0];for(let i=0;i<queue.length;i++)for(const n of neighbors[queue[i]])if(!seen.has(n)){seen.add(n);queue.push(n);}
   assert.equal(seen.size,m.vertices.length,'single connected surface, including fingers');
  }
 }
}
for(const [name,preset] of Object.entries({ ...HUMANOID_PRESETS, procedural: { values: {} }, procedural_female: { values: { shoulder_width: 0.86, hip_width: 1.16, waist_width: 0.78, chest_shape: 0.65, limb_thickness: 0.85 } } })) {
 if (preset.template) continue;
 test(`${name}: rigged manifold game mesh in all poses`,()=>{
  for(const arm_pose of ['t_pose','a_pose','relaxed']) {
   const p={...DEFAULT_HUMANOID,...preset.values,arm_pose};const output=buildHumanoid(p);validate(output,p);
   const m=output.meshes[0];const triangles=m.faces.reduce((n,f)=>n+f.length-2,0);
   assert(triangles<4000,`${triangles} triangles exceeds low-poly budget`);
   assert(Math.abs(Math.max(...m.vertices.map(v=>v[1]))-p.height)<1e-5);
   assert(Math.abs(Math.min(...m.vertices.map(v=>v[1])))<1e-5);
   // Exact mirrored silhouette in X for neutral bases.
   const coords=new Set(m.vertices.map(v=>v.map(n=>Math.round(n*1e5)).join(',')));
   assert(m.vertices.every(v=>coords.has([-v[0],v[1],v[2]].map(n=>Math.round(n*1e5)).join(','))),'bilateral symmetry');
  }
 });
}
test('skeleton-only, minimal rig, and supported mesh styles',()=>{
 for(const style of ['low_poly','smooth','blocky'])for(const fingers of ['none','full'])for(const spine_bones of [1,2,3]) {
  const p={...DEFAULT_HUMANOID,style,fingers,spine_bones,root_bone:false,toes:false};validate(buildHumanoid(p),p);
 }
 const output=buildHumanoid({...DEFAULT_HUMANOID,generate_mesh:false});assert.equal(output.meshes.length,0);assert(output.bones.length>20);
});

const { buildFromTemplate, validateTemplate } = await import(pathToFileURL(path.join(dir, 'template.mjs')));
for (const [sex, vertices, triangles] of [['male',637,1270],['female',673,1342]]) {
 const file=`.local-assets/humanoid/chibi_${sex}.json`;
 const installed=await access(file).then(()=>true,()=>false);
 test(`exact purchased ${sex}: unchanged geometry, UVs, materials and weights`, { skip: !installed }, async()=>{
  const template=JSON.parse(await readFile(file,'utf8'));
  validateTemplate(template);
  assert.equal(template.textures.length,1);
  assert(template.meshes.every(m=>m.face_materials.every(i=>i===0)));
  assert.equal(template.name, `${sex[0].toUpperCase()+sex.slice(1)} Chibi base`);
  assert.equal(template.bones.length,26);
  const boneById=new Map(template.bones.map(b=>[b.id,b]));
  for(const side of ['L','R']) {
   for(const [id,parent] of [['fingers','hand'],['thumb_1','hand'],['thumb_2','thumb_1']]) {
    const bone=boneById.get(`${id}.${side}`);
    assert.equal(bone.parent,`${parent}.${side}`);
    assert(Math.hypot(...bone.head.map((n,i)=>n-bone.tail[i]))>0.05);
    if(id==='thumb_2') assert.deepEqual(bone.head,boneById.get(`thumb_1.${side}`).tail);
    const m=template.meshes[0];
    const influenced=m.vertex_weights.map((w,i)=>[w[bone.id]||0,i]).filter(([w])=>w>0);
    assert(influenced.length>=4,`${bone.id} must deform a surface, not just exist`);
    // A 30-degree local bend must move weighted surface vertices away from rest.
    assert(influenced.some(([w,i])=>{
     const v=m.vertices[i],x=v[0]-bone.head[0],y=v[1]-bone.head[1];
     return w*Math.hypot(x*(Math.cos(Math.PI/6)-1)-y*0.5,x*0.5+y*(Math.cos(Math.PI/6)-1))>0.01;
    }));
    for(const [,i] of influenced) assert.equal(Math.sign(m.vertices[i][0]),side==='L'?1:-1);
   }
  }
  for(const id of ['fingers','thumb_1','thumb_2']) {
   const left=boneById.get(`${id}.L`),right=boneById.get(`${id}.R`);
   for(const point of ['head','tail']) assert.deepEqual(right[point],[-left[point][0],left[point][1],left[point][2]]);
  }
  for(const convention of ['simple','unity','godot','mixamo']) {
   assert.equal(new Set(template.bones.map(b=>boneName(b.id,convention))).size,26);
  }
  const before=JSON.stringify(template);
  const output=buildFromTemplate(template,32);
  assert.deepEqual(output.meshes,template.meshes);
  assert.deepEqual(output.bones,template.bones);
  assert.equal(output.meshes[0].vertices.length,vertices);
  assert.equal(output.meshes[0].faces.reduce((n,f)=>n+f.length-2,0),triangles);
  const scaled=buildFromTemplate(template,64);
  scaled.meshes[0].vertices.forEach((v,i)=>assert.deepEqual(v,template.meshes[0].vertices[i].map(n=>n*2)));
  assert.deepEqual(scaled.meshes[0].face_uvs,template.meshes[0].face_uvs);
  assert.equal(buildFromTemplate(template,32,false).meshes.length,0);
  output.meshes[0].vertices[0][0]=999;
  assert.equal(JSON.stringify(template),before,'template remains reusable');
  assert.throws(()=>buildFromTemplate(template,NaN));
  const invalid=structuredClone(template);invalid.meshes[0].faces[0][0]=-1;
  assert.throws(()=>validateTemplate(invalid));
  const unsafe=structuredClone(template);unsafe.textures[0].file='../other.png';
  assert.throws(()=>validateTemplate(unsafe));
 });
}

test('adapted Male base: bundled source mesh, fitted rig, UVs and scalable skin weights', async () => {
 const template = JSON.parse(await readFile('assets/humanoid/male_base.json', 'utf8'));
 assert.equal(HUMANOID_PRESETS.male.template, 'bodiez_male');
 validateTemplate(template);
 assert.equal(template.name, 'Male base');
 assert.equal(template.bones.length, 28);
 assert.equal(template.textures.length, 0);
 const output = buildFromTemplate(template, 32);
 const mesh = output.meshes[0];
 assert.equal(mesh.vertices.length, 484);
 assert.equal(mesh.faces.reduce((n, f) => n + f.length - 2, 0), 964);
 assert(mesh.face_materials.every(i => i === -1));
 validate(output, { style: 'low_poly' });
 assert(Math.abs(Math.min(...mesh.vertices.map(v => v[1]))) < 1e-5);
 assert(Math.abs(Math.max(...mesh.vertices.map(v => v[1])) - 32) < 1e-5);
 for (const bone of output.bones.filter(b => b.id !== 'root')) {
  const influenced = mesh.vertex_weights.flatMap((w, i) => w[bone.id] ? [i] : []);
  assert(influenced.length >= 4, `${bone.id} must deform the mesh`);
  if (/^(lower_leg|foot|toes|upper_arm|lower_arm|hand|fingers|thumb_[12])\.[LR]$/.test(bone.id)) {
   const sign = bone.id.endsWith('.L') ? 1 : -1;
   assert(influenced.every(i => mesh.vertices[i][0] * sign >= -1e-5), `${bone.id} has opposite-side weights`);
  }
 }
 const scaled = buildFromTemplate(template, 64);
 scaled.meshes[0].vertices.forEach((v, i) => assert.deepEqual(v, mesh.vertices[i].map(n => n * 2)));
 scaled.bones.forEach((b, i) => {
  assert.deepEqual(b.head, output.bones[i].head.map(n => n * 2));
  assert.deepEqual(b.tail, output.bones[i].tail.map(n => n * 2));
 });
 assert.deepEqual(scaled.meshes[0].face_uvs, mesh.face_uvs);
 assert.deepEqual(scaled.meshes[0].vertex_weights, mesh.vertex_weights);
 assert.equal(buildFromTemplate(template, 32, false).meshes.length, 0);
 const invalid = structuredClone(template);
 invalid.meshes[0].face_materials[0] = -2;
 assert.throws(() => validateTemplate(invalid));
 mesh.vertices[0][0] = 999;
 assert.notEqual(template.meshes[0].vertices[0][0], 999);
});

const { buildModularHumanoid, DEFAULT_MODULAR } = await import(pathToFileURL(path.join(dir, 'modular.mjs')));
for (const sex of ['male', 'female']) {
 const file = `.local-assets/humanoid/bodiez_${sex}.json`;
 const installed = await access(file).then(() => true, () => false);
 test(`Bodiez ${sex}: all body types, morphs, rig, UVs, height and mesh options`, { skip: !installed }, async () => {
  assert.equal(HUMANOID_PRESETS[sex].template, `bodiez_${sex}`);
  const template = JSON.parse(await readFile(file, 'utf8'));
  validateTemplate(template);
  const before = JSON.stringify(template);
  assert.equal(template.bones.length, sex === 'male' ? 62 : 64);
  for (const convention of ['simple', 'unity', 'godot', 'mixamo']) assert.equal(new Set(template.bones.map(b => boneName(b.id, convention))).size, template.bones.length);
  for (const body_type of ['regular', 'thin', 'muscular', 'heavy']) for (const hip_fullness of [0, 0.5, 1]) for (const breast_size of sex === 'female' ? [-1, 0, 1] : [0]) {
   const options = { ...DEFAULT_MODULAR, body_type, hip_fullness, breast_size, single_mesh: false };
   const output = buildModularHumanoid(template, 32, true, options);
   const body = output.meshes[0];
   assert(Math.abs(Math.min(...body.vertices.map(v => v[1]))) < 1e-8);
   assert(Math.abs(Math.max(...body.vertices.map(v => v[1])) - 32) < 1e-8);
   const ids = new Set();
   for (const b of output.bones) { assert(!b.parent || ids.has(b.parent)); ids.add(b.id); assert(b.head.concat(b.tail).every(Number.isFinite)); }
   output.meshes.forEach((m, i) => {
    assert(m.vertices.flat().every(Number.isFinite));
    assert.deepEqual(m.faces, template.meshes[i].faces);
    assert.deepEqual(m.face_uvs, template.meshes[i].face_uvs);
    assert.deepEqual(m.vertex_weights, template.meshes[i].vertex_weights);
    for (const w of m.vertex_weights) { assert(Math.abs(Object.values(w).reduce((a,b) => a+b,0)-1)<1e-8); assert(Object.keys(w).every(id=>ids.has(id))); }
   });
  }
  const neutral = buildModularHumanoid(template, 32, true, { ...DEFAULT_MODULAR, single_mesh: false });
  for (const [key, value] of [['body_type','thin'], ['body_type','muscular'], ['body_type','heavy'], ['hip_fullness',1], ...(sex === 'female' ? [['breast_size',-1],['breast_size',1]] : [])]) {
   const changed = buildModularHumanoid(template,32,true,{...DEFAULT_MODULAR,[key]:value,single_mesh:false});
   assert(changed.meshes[0].vertices.some((v,i)=>v.some((n,a)=>Math.abs(n-neutral.meshes[0].vertices[i][a])>1e-4)), `${key} ${value} must change the body`);
  }
  const merged = buildModularHumanoid(template, 32, true, DEFAULT_MODULAR).meshes[0];
  assert.equal(merged.vertices.length, neutral.meshes.reduce((n,m)=>n+m.vertices.length,0));
  assert.deepEqual(merged.face_uvs,neutral.meshes.flatMap(m=>m.face_uvs));
  assert(merged.faces.flat().every(i=>i>=0&&i<merged.vertices.length));
  assert.equal(buildModularHumanoid(template,32,true,{...DEFAULT_MODULAR,include_ears:false}).meshes[0].vertices.length,template.meshes[0].vertices.length);
  assert.equal(buildModularHumanoid(template,32,false,DEFAULT_MODULAR).meshes.length,0);
  const scaled = buildModularHumanoid(template,64,true,DEFAULT_MODULAR);
  scaled.meshes[0].vertices.forEach((v,i)=>assert.deepEqual(v,merged.vertices[i].map(n=>n*2)));
  scaled.bones.forEach((b,i)=>assert.deepEqual(b.head,neutral.bones[i].head.map(n=>n*2)));
  assert.throws(()=>buildModularHumanoid(template,NaN,true,DEFAULT_MODULAR));
  assert.throws(()=>buildModularHumanoid(template,32,true,{...DEFAULT_MODULAR,hip_fullness:2}));
  assert.throws(()=>buildModularHumanoid(template,32,true,{...DEFAULT_MODULAR,body_type:'unknown'}));
  const invalid=structuredClone(template); invalid.customization.morphs[0].Thin.pop(); assert.throws(()=>validateTemplate(invalid));
  assert.equal(JSON.stringify(template),before,'template remains reusable');
 });
}

for (const sex of ['male', 'female']) {
 const file = `.local-assets/humanoid/bodiez_${sex}.json`;
 const installed = await access(file).then(() => true, () => false);
 test(`Bodiez ${sex}: continuous body blending and combined proportion controls`, { skip: !installed }, async () => {
  const template = JSON.parse(await readFile(file, 'utf8'));
  const buildShape = options => buildModularHumanoid(template,32,true,{...DEFAULT_MODULAR,...options});
  const neutral = buildShape({});
  const difference = (a,b) => Math.max(...a.meshes[0].vertices.flatMap((v,i)=>v.map((n,axis)=>Math.abs(n-b.meshes[0].vertices[i][axis]))));
  for (const [name,number] of [['thin',0],['regular',1],['muscular',2],['heavy',3]]) assert.deepEqual(buildShape({body_type:name}),buildShape({body_type:number}));
  for (const center of [0.5,1,1.5,2,2.5]) {
   const a = buildShape({body_type:center-0.0001}), b = buildShape({body_type:center+0.0001});
   assert(difference(a,b)>0,'body type must move continuously');
   assert(difference(a,b)<0.01,'body type must not jump at preset boundaries');
  }
  for (const [key,min,max] of [['head_size',0.5,2],['body_size',0.6,1.6],['shoulder_size',0.6,1.6],['shortness',0,1],['arm_size',0.6,1.5],['leg_size',0.6,1.5]]) {
   for (const value of [min,max]) {
    const output = buildShape({[key]:value,body_type:1.35,hip_fullness:0.4,breast_size:0.3});
    assert(difference(output,neutral)>0.01,`${key} must change the mesh`);
    assert(output.meshes[0].vertices.flat().every(Number.isFinite));
    const bones = new Map(output.bones.map(b=>[b.id,b]));
    for(const b of output.bones) {
     assert(Math.hypot(...b.head.map((v,i)=>v-b.tail[i]))>1e-5);
     if(b.connected) assert(Math.hypot(...b.head.map((v,i)=>v-bones.get(b.parent).tail[i]))<1e-5,`${key}: ${b.id} detached`);
    }
    assert.deepEqual(output.meshes[0].face_uvs,neutral.meshes[0].face_uvs);
    assert.deepEqual(output.meshes[0].vertex_weights,neutral.meshes[0].vertex_weights);
   }
   assert.throws(()=>buildShape({[key]:NaN}));
   assert.throws(()=>buildShape({[key]:max+1}));
  }
  const combined = buildShape({head_size:1.3,body_size:1.15,shoulder_size:0.8,shortness:0.5,arm_size:0.85,leg_size:1.1,body_type:2.4});
  assert(combined.meshes[0].vertices.flat().every(Number.isFinite));
  assert(Math.abs(Math.max(...combined.meshes[0].vertices.map(v=>v[1]))-32)<1e-8);
  assert(difference(combined,neutral)>1);
 });
}
