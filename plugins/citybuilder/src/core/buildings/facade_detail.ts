import source from '../../../assets/facade_modules.json';
import type { BuildingModel, FacadeRow, FacadeRun, ModelPiece } from './types';
import type { Vec2, Vec3 } from '../types';
import { tileRef } from './tiles';
import type { TileKind } from './tiles';

interface Module {bay:number;height:number;vertices:Vec3[];faces:number[][];normals:Vec3[][];materials:string[];}
const modules=source as unknown as Record<string,Module>;

/** What never changes for a module: its depth range and the tile each face is drawn with. */
interface ModuleInfo {minY:number;depthRange:number;kinds:TileKind[];}
const infoCache:Map<string,Map<string,ModuleInfo>>=new Map<string,Map<string,ModuleInfo>>();

function infoOf(key:string,module:Module,curtain:boolean):ModuleInfo {
 const variant:string=curtain?'curtain':'plain';
 let byVariant:Map<string,ModuleInfo>|undefined=infoCache.get(key);
 if(!byVariant){byVariant=new Map<string,ModuleInfo>();infoCache.set(key,byVariant);}
 let info:ModuleInfo|undefined=byVariant.get(variant);
 if(!info){
  let minY:number=Infinity,maxY:number=-Infinity;
  for(const v of module.vertices){if(v[1]<minY)minY=v[1];if(v[1]>maxY)maxY=v[1];}
  const kinds:TileKind[]=module.materials.map((material:string):TileKind=>/Glass|Parallax/.test(material)?curtain?'glass_tower':'glass_room':/Metal|AirConditioner/.test(material)?'metal':/Bricks/.test(material)?'brick':/Painted/.test(material)?'trim':'wall');
  info={minY,depthRange:maxY-minY||1,kinds};
  byVariant.set(variant,info);
 }
 return info;
}

/** Rows that get a real source module: only the ground floor and the first storeys, where the camera can see them. */
function detailedRows(model:BuildingModel):Array<{run:FacadeRun;row:FacadeRow}> {
 const s=model.spec;
 const limit:number=Math.min(9,s.groundHeight+s.floorHeight);
 const rows:Array<{run:FacadeRun;row:FacadeRow}>=[];
 for(const run of model.facades)for(const row of run.rows){
  if(row.y0<0||row.y0>limit||row.height<2)continue;
  rows.push({run,row});
 }
 return rows;
}

/** Triangles the facade-module detail adds to one instance of the building, without building it. */
export function detailTriangles(model:BuildingModel):number {
 const s=model.spec;
 if(s.style==='industrial'||s.archetype==='wind_turbine')return 0;
 const curtain:boolean=s.style==='curtain';
 const style=curtain?(s.seed%2?7:10):1;
 let total:number=0;
 for(const {run,row} of detailedRows(model)){
  const module=modules[`${style}_${row.y0===0?'GF':'Floor'}`];
  let tris:number=0;
  for(const face of module.faces)tris+=face.length-2;
  total+=tris*run.bays;
 }
 return total;
}

/**
 * Real recessed storefronts and window modules at racing-camera height; flat proxies replace them in LOD1.
 * The rows are marked at once, but the thousands of detail pieces are only built when `pieces` is first read,
 * so a city shown at a coarse level of detail never builds them.
 */
export function addFacadeDetail(model:BuildingModel):BuildingModel {
 const s=model.spec;
 if(s.style==='industrial'||s.archetype==='wind_turbine')return model;
 const rows=detailedRows(model);
 if(rows.length===0)return model;
 for(const {row} of rows)row.nativeDetail=true;
 const core:ModelPiece[]=model.pieces;
 model.corePieces=core.slice();
 let built:boolean=false;
 Object.defineProperty(model,'pieces',{
  configurable:true,
  enumerable:true,
  get():ModelPiece[]{
   if(!built){built=true;buildDetail(model,core,rows);}
   return core;
  },
 });
 return model;
}

function buildDetail(model:BuildingModel,out:ModelPiece[],rows:Array<{run:FacadeRun;row:FacadeRow}>):void {
 const s=model.spec;
 const curtain:boolean=s.style==='curtain';
 const style=curtain?(s.seed%2?7:10):1;
 for(const {run,row} of rows){
  // Curved towers use one source module per facet; the module follows the actual loft endpoints.
  const key=`${style}_${row.y0===0?'GF':'Floor'}`;
  const module=modules[key];
  const info:ModuleInfo=infoOf(key,module,curtain);
  const depthScale=Math.min(1,(row.y0===0?.65:.35)/info.depthRange);
  const verts:Vec3[]=new Array<Vec3>(module.vertices.length);
  for(let bay=0;bay<run.bays;bay++){
   // Every module vertex is placed once per bay; its faces share the result.
   for(let vi=0;vi<module.vertices.length;vi++)verts[vi]=placeVertex(module,run,row,module.vertices[vi],bay,depthScale,info.minY);
   for(let fi=0;fi<module.faces.length;fi++)pushPiece(out,module.faces[fi],verts,info.kinds[fi],s.palette);
  }
 }
}

function placeVertex(module:Module,run:FacadeRun,row:FacadeRow,v:Vec3,bay:number,depthScale:number,minY:number):Vec3 {
 let x:number,y:number,z:number;
 if(row.corners){
  const [a,b,c,d]=row.corners;
  const u=(bay+.5+v[0]/module.bay)/run.bays,t=v[2]/module.height;
  const lx=a[0]+(b[0]-a[0])*u,ly=a[1]+(b[1]-a[1])*u,lz=a[2]+(b[2]-a[2])*u;
  const hx=d[0]+(c[0]-d[0])*u,hy=d[1]+(c[1]-d[1])*u,hz=d[2]+(c[2]-d[2])*u;
  x=lx+(hx-lx)*t;y=ly+(hy-ly)*t;z=lz+(hz-lz)*t;
 }else{
  const along=(bay+.5)*run.bayWidth+v[0]*(run.bayWidth/module.bay);
  x=run.origin[0]+run.along[0]*along;y=row.y0+v[2]*(row.height/module.height);z=run.origin[2]+run.along[2]*along;
 }
 const offset=(minY-v[1])*depthScale;
 return [x+run.normal[0]*offset,y,z+run.normal[2]*offset];
}

function pushPiece(out:ModelPiece[],face:number[],verts:Vec3[],kind:TileKind,palette:number):void {
 const n:number=face.length;
 const corners:Vec3[]=new Array<Vec3>(n);
 for(let i=0;i<n;i++){const p=verts[face[i]];corners[i]=[p[0],p[1],p[2]];}
 // Derive the normal from the transformed geometry: correct even on a tapered or twisting loft.
 const a=corners[0],b=corners[1],c=corners[2];
 const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
 let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
 const length=Math.hypot(nx,ny,nz);if(length<1e-9)return;
 nx/=length;ny/=length;nz/=length;
 const ax=Math.abs(nx),ay=Math.abs(ny),az=Math.abs(nz);
 const drop=ax>=ay&&ax>=az?0:ay>=az?1:2;
 const ia=drop===0?2:0,ib=drop===1?2:1;
 let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
 for(let i=0;i<n;i++){
  const pu=corners[i][ia],pv=corners[i][ib];
  if(pu<minU)minU=pu;if(pu>maxU)maxU=pu;if(pv<minV)minV=pv;if(pv>maxV)maxV=pv;
 }
 const spanU=maxU-minU||1,spanV=maxV-minV||1;
 const count:number=n===4?4:Math.min(n,4);
 const uvs:Vec2[]=new Array<Vec2>(count);
 for(let i=0;i<count;i++)uvs[i]=[(corners[i][ia]-minU)/spanU,1-(corners[i][ib]-minV)/spanV];
 const normal:Vec3=[nx,ny,nz];
 const normals:Vec3[]=new Array<Vec3>(n);
 for(let i=0;i<n;i++)normals[i]=normal;
 out.push({corners,uvs,normals,tile:tileRef(kind,palette),tag:'trim',maxLod:0});
}
