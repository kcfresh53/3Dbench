import type { Branch, TreeParams, Vec2, Vec3 } from './types';
import { MeshBuilder, countTriangles } from './mesh_builder';
import { Rng } from './rng';
import { add, clamp, cross, lerp, normalize, scale, sub } from './math';
import { addBranchTube } from './tube_mesh';
import { BARK_UV, LEAF_CARD_UV, SOLID_UV } from './uv_layout';

/** A tapered leaflet, with a folded midrib and a pointed, drooping tip. */
function addLeaflet(mesh: MeshBuilder, base: Vec3, tip: Vec3, width: number): void {
 const direction = normalize(sub(tip,base));
 const across = scale(normalize(cross(direction,[0,1,0])),width/2);
 const middle = add(base,scale(sub(tip,base),0.48));
 const ridge = add(middle,[0,width*0.18,0]);
 const points = [base,sub(middle,across),ridge,add(middle,across),tip];
 const indices = points.map(point=>mesh.addVertex(point));
 const u = LEAF_CARD_UV;
 const mid = (u.u0+u.u1)/2;
 const uv: Vec2[] = [[mid,u.v1],[u.u0,(u.v0+u.v1)/2],[mid,(u.v0+u.v1)/2],[u.u1,(u.v0+u.v1)/2],[mid,u.v0]];
 for(const face of [[0,1,2],[0,2,3],[1,4,2],[2,4,3]]) mesh.addFace(face.map(i=>indices[i]),face.map(i=>uv[i]));
}

/** Coconut-style palm: one curved stem and a crown of pinnate arching fronds. */
export function buildPalm(p: TreeParams, quality: number) {
 const trunk = new MeshBuilder();
 const foliage = new MeshBuilder();
 const rng = new Rng(p.seed);
 const heading = rng.range(0,Math.PI*2);
 const lean = p.height*p.trunkBend*0.6;
 const segments = Math.max(3,Math.round(p.trunkSegments*(0.35+0.65*quality)));
 const points: Vec3[] = [], radii: number[] = [];
 for(let i=0;i<=segments;i++) {
  const t=i/segments;
  const bend=lean*(0.3*t+0.7*t*t);
  const bow=lean*0.35*Math.sin(Math.PI*t);
  points.push([Math.cos(heading)*bend-Math.sin(heading)*bow,p.height*t,Math.sin(heading)*bend+Math.cos(heading)*bow]);
  radii.push(p.height*p.trunkThickness/100*lerp(1,p.trunkTaper,t)*(1+p.rootFlare*Math.exp(-t*18)));
 }
 const stem: Branch = {points,radii,level:0,length:p.height};
 addBranchTube(trunk,stem,Math.max(3,Math.round(p.trunkSides*(0.5+0.5*quality))),BARK_UV);
 const crown=points[points.length-1];
 const total=Math.max(4,Math.round(p.branchCount));
 if(p.foliageStyle!=='none') for(let i=0;i<total;i++) {
  // Deterministic thinning retains the shape of each remaining frond in LODs.
  if((i*0.61803398875)%1>Math.max(0.23,quality)) continue;
  const random=new Rng(p.seed+1299721*(i+1));
  const angle=heading+i*Math.PI*(3-Math.sqrt(5))+random.range(-0.12,0.12);
  const radial: Vec3=[Math.cos(angle),0,Math.sin(angle)];
  const side: Vec3=[-Math.sin(angle),0,Math.cos(angle)];
  const tier=i%3;
  const length=p.height*p.branchLength*random.range(0.85,1.12);
  const reach=tier===2 ? 0.72 : 1;
  const rise=[0.2,0.65,1.1][tier]+(75-p.branchAngle)/100;
  const droop=[0.8,0.9,0.85][tier]-p.gravity*0.35;
  const at=(t:number):Vec3=>add(crown,add(scale(radial,length*reach*t),[0,length*(rise*t-droop*t*t),0]));
  const sections=Math.max(3,Math.round((p.variant==='realistic'?9:5)*(0.4+quality*0.6)));
  const rachis:Branch={points:[],radii:[],level:1,length};
  for(let j=0;j<=sections;j++) {
   rachis.points.push(at(j/sections));
   rachis.radii.push(j===sections?0:p.height*0.0018*(1-j/sections));
  }
  addBranchTube(foliage,rachis,3,SOLID_UV);
  const pairs=Math.max(3,Math.round(p.foliageDensity*(p.variant==='realistic'?5:3)*(0.25+quality*0.75)));
  for(let j=0;j<pairs;j++) {
   const t=lerp(clamp(p.foliageStart,0.05,0.7),0.97,(j+0.5)/pairs);
   const base=at(t);
   const envelope=Math.pow(Math.sin(Math.PI*t),0.75)*(1-t*0.45);
   for(const sign of [-1,1]) {
    const span=length*(p.foliageSize/100)*envelope*random.range(0.85,1.1);
    const tip=add(base,add(scale(side,sign*span),add(scale(radial,span*random.range(0.12,0.34)),[0,-span*(0.22+t*0.45),0])));
    const width=span*(p.variant==='realistic'?0.2:0.3);
    addLeaflet(foliage,base,tip,width);
   }
  }
 }
 const trunkData=trunk.toData(), foliageData=foliage.toData();
 return {trunk:trunkData,foliage:foliageData,triangles:countTriangles(trunkData)+countTriangles(foliageData)};
}
