import {transformDeterminant} from './generator.mjs';
// An isolated, instanced viewport. Geometry and textures are shared between repeated modules.
export function makePreview(canvas,status,library,output) {
 const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
 renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setClearColor(0x252e38);
 renderer.outputEncoding=THREE.sRGBEncoding;
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(32,1,0.1,5000);
 scene.add(new THREE.HemisphereLight(0xdcecff,0x49505c,0.8));
 const sun=new THREE.DirectionalLight(0xffeedb,1.4);sun.position.set(-30,50,40);scene.add(sun);
 const fill=new THREE.DirectionalLight(0xc9e4ff,0.35);fill.position.set(40,15,-30);scene.add(fill);
 let disposed=false,model,target=new THREE.Vector3(),radius=55,yaw=0.57,pitch=0.16,zoom=1;
 const texture=new THREE.TextureLoader().load(library.atlas.data,()=>{if(!disposed)draw();});
 texture.encoding=THREE.sRGBEncoding;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
 const material=new THREE.MeshStandardMaterial({map:texture,roughness:0.82,metalness:0.05,side:THREE.DoubleSide});
 const cache=new Map();
 function geometry(name,mirror) {
  const key=name+mirror;if(cache.has(key))return cache.get(key);
  const source=library.modules[name],position=[],normal=[],uv=[],sign=mirror?-1:1;
  for(let fi=0;fi<source.faces.length;fi++){
   const face=source.faces[fi];
   for(let i=1;i<face.length-1;i++)for(const corner of mirror?[0,i+1,i]:[0,i,i+1]){
    const v=source.vertices[face[corner]],n=source.normals[fi][corner];
    position.push(v[0]*sign,v[2],-v[1]);normal.push(n[0]*sign,n[2],-n[1]);uv.push(...source.uvs[fi][corner]);
   }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(position,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));cache.set(key,g);return g;
 }
 function draw(){
  if(disposed)return;
  const width=canvas.clientWidth||600,height=canvas.clientHeight||600;
  renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
  camera.position.set(target.x+Math.sin(yaw)*Math.cos(pitch)*radius*zoom,target.y+Math.sin(pitch)*radius*zoom,target.z+Math.cos(yaw)*Math.cos(pitch)*radius*zoom);
  camera.lookAt(target);renderer.render(scene,camera);
 }
 function update(next){
  output=next;
  if(model){scene.remove(model);model.traverse(m=>m.isInstancedMesh&&m.dispose?.());}
  model=new THREE.Group();const grouped=new Map();
  for(const entry of output.instances){const m=entry.transform,mirror=transformDeterminant(m)<0,key=entry.module+mirror;let bucket=grouped.get(key);if(!bucket){bucket={name:entry.module,mirror,entries:[]};grouped.set(key,bucket);}bucket.entries.push(entry);}
  for(const {name,mirror,entries} of grouped.values()){
   const mesh=new THREE.InstancedMesh(geometry(name,mirror),material,entries.length),scale=output.params.scale,sign=mirror?-1:1;
   entries.forEach((entry,i)=>{const m=entry.transform;let matrix;
    if(m.length===16)matrix=new THREE.Matrix4().set(m[0]*sign,m[2],-m[1],m[3],m[8]*sign,m[10],-m[9],m[11],-m[4]*sign,-m[6],m[5],-m[7],0,0,0,1).premultiply(new THREE.Matrix4().makeScale(scale,scale,scale));
    else {const [a,b,c,d,x,y,z]=m;matrix=new THREE.Matrix4().set(a*sign*scale,0,-b*scale,x*scale,0,scale,0,z*scale,-c*sign*scale,0,d*scale,-y*scale,0,0,0,1);}
    mesh.setMatrixAt(i,matrix);
   });
   mesh.instanceMatrix.needsUpdate=true;mesh.frustumCulled=false;model.add(mesh);
  }
  scene.add(model);
  const {min,max}=output.bounds;target.set(...max.map((v,i)=>(v+min[i])/2));
  const size=max.map((v,i)=>v-min[i]);
  const aspect=(canvas.clientWidth||600)/(canvas.clientHeight||600);
  radius=((Math.max(size[1],(size[0]+size[2]*0.45)/aspect)/2)/Math.tan(16*Math.PI/180)+size[2]*0.65)*1.12;
  status.textContent=output.summary || `${output.params.floors+output.params.top_floors+1} floors  ·  ${output.instances.length} modules  ·  ${output.triangles.toLocaleString()} triangles`;
  draw();
 }
 let drag;
 const down=e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);};
 const move=e=>{if(!drag)return;yaw-=(e.clientX-drag[0])*0.009;pitch=Math.max(-0.2,Math.min(1.35,pitch+(e.clientY-drag[1])*0.007));drag=[e.clientX,e.clientY];draw();};
 const up=()=>{drag=null;};
 const wheel=e=>{e.preventDefault();zoom=Math.max(0.45,Math.min(3,zoom*Math.exp(e.deltaY*0.001)));draw();};
 const reset=()=>{zoom=1;yaw=0.57;pitch=0.16;draw();};
 const listeners={pointerdown:down,pointermove:move,pointerup:up,lostpointercapture:up,wheel,dblclick:reset};
 for(const [name,fn] of Object.entries(listeners))canvas.addEventListener(name,fn,{passive:false});
 const observer=new ResizeObserver(draw);observer.observe(canvas);update(output);
 return {update,dispose(){disposed=true;observer.disconnect();for(const [name,fn] of Object.entries(listeners))canvas.removeEventListener(name,fn);model?.traverse(m=>m.isInstancedMesh&&m.dispose?.());cache.forEach(g=>g.dispose());material.dispose();texture.dispose();renderer.dispose();}};
}
