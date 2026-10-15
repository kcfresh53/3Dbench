import {layoutInstances} from './layout.mjs';
import {transformVertex} from './generator.mjs';
export const NATIVE_DEFAULTS={style:1,preset:1,shape:'preset',width:6,depth:5,floors:5,scale:1,module_size:1,palette:1,plain:'source',stairs:'source',source_details:true,roof_amount:25,ac:10,tanks:1,antennas:1,hvac:true,access:true,hatches:true,solar:true,skylights:true,seed:1,lit:0,light_intensity:1,light_color:'#ffd399'};
const clamp=(value,min,max)=>Math.min(max,Math.max(min,Number(value)||0));
export function normalizeNative(input={}){
 const p={...NATIVE_DEFAULTS,...input};
 for(const [key,min,max] of [['style',1,10],['preset',1,5],['width',2,16],['depth',2,16],['floors',1,24],['palette',1,5],['roof_amount',0,100],['ac',0,100],['tanks',0,10],['antennas',0,10],['seed',0,2147483647],['lit',0,100]])p[key]=Math.round(clamp(p[key],min,max));
 p.module_size=clamp(p.module_size??1,.1,100);
 p.scale=clamp(p.scale,.1,10);p.light_intensity=clamp(p.light_intensity,0,2);
 if(!['preset','rectangle','l','u','courtyard','mesh'].includes(p.shape))p.shape='preset';
 return p;
}
const identity=(x=0,y=0,z=0)=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1].map((v,i)=>i===3?x:i===7?y:i===11?z:v);
const position=m=>m.length===16?[m[3],m[7],m[11]]:[m[4],m[5],m[6]];
function faceDirection(m){const x=m.length===16?-m[1]:-m[1],y=m.length===16?-m[5]:-m[3];return Math.abs(x)>Math.abs(y)?x>0?'right':'left':y>0?'back':'front';}
const chosen=(side,entry)=>side==='all'||side===faceDirection(entry.transform);
export function nativePlan(input,library){
 const p=normalizeNative(input),[bay,floor,ground]=library.sizes;let instances=[];
 const add=(module,transform,category)=>{if(library.modules[module])instances.push({module,transform,category});};
 let state=p.seed>>>0;const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
 if(p.shape==='mesh'){
  p.scale=1;layoutInstances(p,library,add);
 }else if(p.shape==='preset'){
  const preset=library.presets[`Building_${p.style}-${p.preset}`];if(!preset)throw Error('This preset is missing from the native library.');
  instances=preset.instances.map(e=>({...e,transform:[...e.transform],category:'Source preset'}));
 }else{
  const w=p.width,d=p.depth,occupied=(x,y)=>x>=0&&y>=0&&x<w&&y<d&&!(p.shape==='l'&&x>=Math.ceil(w/2)&&y>=Math.ceil(d/2))&&!(p.shape==='u'&&x>=Math.ceil(w/3)&&x<w-Math.ceil(w/3)&&y>=Math.ceil(d/3))&&!(p.shape==='courtyard'&&x>=Math.ceil(w/3)&&x<w-Math.ceil(w/3)&&y>=Math.ceil(d/3)&&y<d-Math.ceil(d/3));
  for(let x=0;x<w;x++)for(let y=0;y<d;y++)if(occupied(x,y)){
   add(`M.B${p.style}.Roof`,identity((x+.5-w/2)*bay,(y+.5-d/2)*bay,ground+p.floors*floor),'Roof');
   for(const [tx,ty,ox,oy,cx,cy] of [[1,0,0,-1,x+.5,y],[0,1,1,0,x+1,y+.5],[-1,0,0,1,x+.5,y+1],[0,-1,-1,0,x,y+.5]]){
    if(occupied(x+ox,y+oy))continue;
    const corner=sign=>!occupied(x+sign*tx,y+sign*ty)?'Ext':occupied(x+sign*tx+ox,y+sign*ty+oy)?'Inn':null;
    const left=corner(-1),right=corner(1);let suffix='Regular',flip=1;
    if(left&&right){suffix=left===right?`Corner-${left}2`:'Corner-Both';if(left==='Inn')flip=-1;}
    else if(left||right){suffix=`Corner-${left||right}`;if(left)flip=-1;}
    const matrix=z=>[tx*flip,-ty,ty*flip,tx,(cx-w/2)*bay,(cy-d/2)*bay,z];
    add(`M.B${p.style}.GF.${suffix}`,matrix(0),'Storefronts');
    for(let level=0;level<p.floors;level++)add(`M.B${p.style}.Floor.${suffix}`,matrix(ground+level*floor),'Floors');
    add(`M.B${p.style}.RoofE.${suffix}`,matrix(ground+(p.floors-1)*floor),'Cornice');
    if(p.stairs!=='none'&&p.stairs!=='source'&&chosen(p.stairs,{transform:matrix(0)})&&((Math.abs(tx)===1&&x===Math.floor(w/2))||(Math.abs(ty)===1&&y===Math.floor(d/2)))){
     for(let level=0;level<p.floors;level++)add(level===p.floors-1?'Stairs Last Stair':'Stairs Middle Stair',matrix(ground+level*floor),'Fire escapes');
    }
   }
  }
 }
 if(p.plain!=='source')instances=instances.map(e=>{
  if(!/^M(?:-Plain)?\.B\d+\.(GF|Floor|RoofE)\./.test(e.module))return e;
  const regular=e.module.replace('M-Plain.','M.'),module=chosen(p.plain,e)?regular.replace('M.','M-Plain.'):regular;
  return library.modules[module]?{...e,module}:e;
 });
 if(['preset','mesh'].includes(p.shape)&&p.stairs!=='source'){
  instances=instances.filter(e=>!e.module.startsWith('Stairs ')&&!library.modules[e.module]?.materials?.some(m=>m==='FlexiBLD_Stairs'));
  if(p.stairs!=='none'){
   const levels=new Map();
   for(const e of instances)if(/\.Floor\./.test(e.module)&&chosen(p.stairs,e)){
    const pos=position(e.transform),side=faceDirection(e.transform),key=side+':'+Math.round(pos[2]*1000);if(!levels.has(key))levels.set(key,[]);levels.get(key).push(e);
   }
   const highest=Math.max(0,...[...levels.values()].flat().map(e=>position(e.transform)[2]));
   for(const walls of levels.values()){
    const axis=['front','back'].includes(faceDirection(walls[0].transform))?0:1;walls.sort((a,b)=>position(a.transform)[axis]-position(b.transform)[axis]);const wall=walls[Math.floor(walls.length/2)];
    add(position(wall.transform)[2]>=highest-.01?'Stairs Last Stair':'Stairs Middle Stair',[...wall.transform],'Fire escapes');
   }
  }
 }
 const accessory=name=>!/^M(?:-Plain)?\./.test(name)&&!name.startsWith('Stairs ');
 if(!p.source_details||p.shape!=='preset'){
  instances=instances.filter(e=>!accessory(e.module));
  const roofs=instances.filter(e=>e.module.endsWith('.Roof'));
  const types=[];if(p.hvac)types.push('HVAC-System_');if(p.access)types.push('Rooftop-Acess_');if(p.hatches)types.push('Roof-Hatch_');if(p.solar)types.push('Solar-Plate_');if(p.skylights)types.push('Skylight_');
  const modules=Object.keys(library.modules),pick=prefix=>{const names=modules.filter(n=>n.startsWith(prefix));return names[Math.floor(random()*names.length)];};
  const place=(module,roof)=>{if(!module||!roof)return;const [x,y,z]=position(roof.transform);let m=identity(x,y,z);const example=Object.values(library.presets).flatMap(p=>p.instances).find(i=>i.module===module);if(example){m=[...example.transform];m[3]=x;m[7]=y;m[11]=z;}add(module,m,'Rooftop equipment');};
  for(const roof of roofs)if(types.length&&random()*100<p.roof_amount)place(pick(types[Math.floor(random()*types.length)]),roof);
  const specialRoofs=[...roofs];
  for(const [prefix,count] of [['Wood-WT_',p.tanks],['Antenna_',p.antennas]])for(let i=0;i<count&&specialRoofs.length;i++)place(pick(prefix),specialRoofs.splice(Math.floor(random()*specialRoofs.length),1)[0]);
  for(const wall of [...instances])if(/\.Floor\./.test(wall.module)&&!wall.module.startsWith('M-Plain')&&random()*100<p.ac)add(pick('AC_'),[...wall.transform],'Air conditioners');
 }
 if(p.stairs==='none')instances=instances.filter(e=>!e.module.startsWith('Stairs ')&&!library.modules[e.module]?.materials?.some(m=>m==='FlexiBLD_Stairs'));
 if(p.lit)instances=instances.map(e=>/^M\.B\d+\.(GF|Floor)\./.test(e.module)&&random()*100<p.lit?{...e,module:e.module+'#lit'}:e);
 return {params:p,instances};
}
export function nativeOutput(input,library){
 const output=nativePlan(input,library),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let triangles=0;const bounds=new Map();
 for(const e of output.instances){
  const module=library.modules[e.module]||library.modules[e.module.replace('#lit','')];if(!module)throw Error('Missing source module: '+e.module);
  triangles+=module.faces.reduce((n,f)=>n+f.length-2,0);if(triangles>1500000)throw Error('Reduce the dimensions or details to stay below 1.5 million triangles.');
  let b=bounds.get(e.module);if(!b){b=[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]];for(const v of module.vertices)for(let a=0;a<3;a++){b[0][a]=Math.min(b[0][a],v[a]);b[1][a]=Math.max(b[1][a],v[a]);}bounds.set(e.module,b);}
  for(let i=0;i<8;i++){const v=transformVertex([b[i&1][0],b[(i>>1)&1][1],b[(i>>2)&1][2]],e.transform,output.params.scale);for(let a=0;a<3;a++){min[a]=Math.min(min[a],v[a]);max[a]=Math.max(max[a],v[a]);}}
 }
 return {...output,bounds:{min,max},triangles,label:`FlexiBuilding ${output.params.style}`,summary:`Style ${output.params.style} · palette ${output.params.palette} · ${output.instances.length} modules · ${triangles.toLocaleString()} triangles`};
}
