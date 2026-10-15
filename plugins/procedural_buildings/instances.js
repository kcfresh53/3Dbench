import {transformDeterminant} from './generator.mjs';
export function makeInstances(library){
 const texture=new THREE.TextureLoader().load(library.atlas.data);
 // The main editor renders baked atlas colors without an sRGB output transform.
 const material=new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide});
 let model;
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
 return {update(output){
 if(model){model.removeFromParent();model.traverse(m=>m.isInstancedMesh&&m.dispose?.());}
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
 model.no_export=true;model.name='Procedural building preview';return model;
 },dispose(){model?.removeFromParent();model?.traverse(m=>m.isInstancedMesh&&m.dispose?.());cache.forEach(g=>g.dispose());material.dispose();texture.dispose();}};
}
