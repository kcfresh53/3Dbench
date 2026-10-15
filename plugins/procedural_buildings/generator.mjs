// Placement rules ported from the supplied Geometry Nodes kit. Artwork is imported separately.
export const STYLES = Object.freeze({
 b1:{label:'Red brick · arched windows',prefix:'B1',module:3,ground:3.5,floor:4,divider:0.6,defaults:{bays_x:6,bays_z:4,floors:5,top_floors:2,seed:1}},
 b2:{label:'Terracotta · balconies',prefix:'B2',module:2,ground:3.5,floor:3.8,divider:0.4,defaults:{bays_x:9,bays_z:6,floors:5,top_floors:1,seed:2}},
 b3:{label:'Industrial · gridded windows',prefix:'B3',module:2.6,ground:3.8,floor:3.5,divider:0.4,defaults:{bays_x:6,bays_z:5,floors:5,top_floors:1,seed:3}},
});
export const DEFAULTS=Object.freeze({style:'b1',...STYLES.b1.defaults,scale:1,extra_1:50,extra_2:50,ground_1:50,ground_2:50});
export const MAX_TRIANGLES=2000000;
const clamp=(v,d,min,max,int=false)=>{let n=Number(v);if(!Number.isFinite(n))n=d;n=Math.min(max,Math.max(min,n));return int?Math.round(n):n;};
export function normalize(input={}) {
 const p=Object.fromEntries(Object.entries(DEFAULTS).map(([k,v])=>[k,input[k]??v]));
 if(!STYLES[p.style])p.style='b1';
 for(const [k,min,max,int] of [['bays_x',2,12,true],['bays_z',2,12,true],['floors',1,12,true],['top_floors',1,4,true],['scale',0.1,10,false],['extra_1',0,100,true],['extra_2',0,100,true],['ground_1',0,100,true],['ground_2',0,100,true],['seed',0,2147483647,true]])p[k]=clamp(p[k],DEFAULTS[k],min,max,int);
 return p;
}
// Blender-local XY is horizontal, Z is up. A transform is [a,b,c,d,x,y,z].
export function planBuilding(input={},styleData) {
 const p=normalize(input),s=styleData||STYLES[p.style],L=s.module,X=p.bays_x-1,Y=p.bays_z-1;
 const instances=[],windows=[],grounds=[];
 const add=(suffix,m,category)=>{const entry={module:`${s.prefix} ${suffix}`,transform:m,category};instances.push(entry);return entry;};
 function facade(z,sideName,cornerName,category) {
  const points=[];
  for(const side of [-1,1])for(let i=0;i<=X;i++){
   const corner=i===0||i===X,flip=i===0?-1:1;
   const m=[corner?flip:1,0,0,-side,(i-X/2)*L,side*(Y+1)*L/2,z];
   points.push(add(corner?cornerName:sideName,m,category));
  }
  for(const side of [1,-1])for(let i=0;i<=Y;i++){
   const corner=i===0||i===Y,flip=i===0?-1:1;
   const m=[0,-side,corner?flip:1,0,side*(X+1)*L/2,(i-Y/2)*L,z];
   points.push(add(corner?cornerName:sideName,m,category));
  }
  return points;
 }
 grounds.push(...facade(0,'Ground floor','Ground floor corner','Storefronts'));
 for(let i=0;i<p.floors;i++)windows.push(...facade(s.ground+i*s.floor,'Window','Window corner','Middle floors').map(e=>({...e,top:false})));
 const dividerZ=s.ground+p.floors*s.floor;
 for(let i=0;i<p.top_floors;i++)windows.push(...facade(dividerZ+s.divider+i*s.floor,'Top floor window','Top floor window corner','Upper floors').map(e=>({...e,top:true})));
 function roofGrid(z,sideName,cornerName,middleName,category) {
  for(let i=0;i<=X;i++)for(let j=0;j<=Y;j++) {
   const x=(i-X/2)*L,y=(j-Y/2)*L,edgeX=i===0||i===X,edgeY=j===0||j===Y;
   let r;
   if(edgeX&&edgeY)r=i===X?(j===0?[1,0,0,1]:[0,-1,1,0]):(j===0?[0,1,-1,0]:[-1,0,0,-1]);
   else if(edgeX)r=i===0?[0,1,-1,0]:[0,-1,1,0];
   else if(edgeY)r=j===0?[1,0,0,1]:[-1,0,0,-1];
   else if(!middleName)continue;
   else r=[1,0,0,1];
   add(edgeX&&edgeY?cornerName:edgeX||edgeY?sideName:middleName,[...r,x,y,z],category);
  }
 }
 roofGrid(dividerZ,'Top floors div','Top floors div corner',null,'Upper cornice');
 const roofZ=dividerZ+s.divider+p.top_floors*s.floor;
 roofGrid(roofZ,'Roof side','Roof corner','Roof middle','Roof');
 let randomState=p.seed>>>0;
 const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
 if(s.extras)for(let channel=0;channel<4;channel++){
  const spec=s.extras[channel],amount=p[['extra_1','extra_2','ground_1','ground_2'][channel]];
  const candidates=channel<2?windows.filter(e=>e.top?spec.top:spec.normal):grounds.filter(e=>e.module.endsWith('corner')?spec.top:spec.normal);
  for(const e of candidates)if(random()*100<amount){
   const module=spec.modules[Math.floor(random()*spec.modules.length)];
   instances.push({module,transform:[...e.transform],category:channel<2?'Facade details':'Shop awnings & planters'});
  }
 }
 return {params:p,instances,bodyDimensions:[(X+1)*L,roofZ,(Y+1)*L].map(v=>v*p.scale)};
}
export function buildBuilding(input,library) {
 if(library?.version!==2)throw new Error('The Blender module library is missing. Rebuild the plugin using the supplied .blend file.');
 const params=normalize(input),output=planBuilding(params,library.styles[params.style]);
 let triangles=0;const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 const bounds=new Map();
 for(const instance of output.instances){
  const module=library.modules[instance.module];
  if(!module)throw new Error(`Missing module: ${instance.module}`);
  triangles+=module.faces.reduce((n,f)=>n+f.length-2,0);
  if(triangles>MAX_TRIANGLES)throw new Error('This combination exceeds 2 million triangles. Reduce the floor count, building width, or detail amounts.');
  let b=bounds.get(instance.module);
  if(!b){b=[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]];for(const v of module.vertices)for(let a=0;a<3;a++){b[0][a]=Math.min(b[0][a],v[a]);b[1][a]=Math.max(b[1][a],v[a]);}bounds.set(instance.module,b);}
  for(let i=0;i<8;i++){
   const v=transformVertex([b[i&1][0],b[(i>>1)&1][1],b[(i>>2)&1][2]],instance.transform,params.scale);
   for(let a=0;a<3;a++){min[a]=Math.min(min[a],v[a]);max[a]=Math.max(max[a],v[a]);}
  }
 }
 return {...output,triangles,bounds:{min,max},dimensions:max.map((v,i)=>v-min[i])};
}
export function transformDeterminant(m) {
 return m.length===16?m[0]*(m[5]*m[10]-m[6]*m[9])-m[1]*(m[4]*m[10]-m[6]*m[8])+m[2]*(m[4]*m[9]-m[5]*m[8]):m[0]*m[3]-m[1]*m[2];
}
export function transformVertex(v,m,scale=1) {
 if(m.length===16)return [(m[0]*v[0]+m[1]*v[1]+m[2]*v[2]+m[3])*scale,(m[8]*v[0]+m[9]*v[1]+m[10]*v[2]+m[11])*scale,-(m[4]*v[0]+m[5]*v[1]+m[6]*v[2]+m[7])*scale];
 return [(m[0]*v[0]+m[1]*v[1]+m[4])*scale,(v[2]+m[6])*scale,-(m[2]*v[0]+m[3]*v[1]+m[5])*scale];
}
// Materialize only on confirmation; preview instances reuse their source buffers.
export function materializeBuilding(output,library) {
 const meshes=[],buckets=new Map();
 for(const instance of output.instances){
  const source=library.modules[instance.module],m=instance.transform,mirror=transformDeterminant(m)<0;
  let target=buckets.get(instance.module);
  if(!target||target.vertices.length+source.vertices.length>24000){
   target={name:instance.module.replace(/^B\d /,''),category:instance.category,vertices:[],faces:[],uvs:[]};meshes.push(target);buckets.set(instance.module,target);
  }
  const start=target.vertices.length;
  for(const v of source.vertices)target.vertices.push(transformVertex(v,m,output.params.scale));
  for(let i=0;i<source.faces.length;i++){
   let face=source.faces[i].map(v=>v+start),uv=source.uvs[i].map(v=>[v[0],1-v[1]]);
   if(mirror){face.reverse();uv.reverse();}
   target.faces.push(face);target.uvs.push(uv);
  }
 }
 return meshes;
}
