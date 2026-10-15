// A closed orthogonal modeling cage becomes an exact, variable-width height field.
// Coordinates here use the source kit convention: X/Y ground plane, Z up.
const EPS=1e-5;
const unique=values=>[...new Set(values.map(v=>Number(v.toFixed(5))))].sort((a,b)=>a-b);
function inside(x,y,polygon){
 let hit=false;
 for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
  const a=polygon[i],b=polygon[j];
  if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;
 }
 return hit;
}
export function captureLayout(mesh){
 const vertices=Object.fromEntries(Object.entries(mesh.vertices).map(([key,v])=>[key,[v[0],-v[2],v[1]]]));
 return {vertices,faces:Object.values(mesh.faces).filter(f=>f.vertices.length>2).map(f=>(f.getSortedVertices?f.getSortedVertices():f.vertices).slice())};
}
export function layoutGrid(layout,bay){
 if(!layout?.faces?.length)throw Error('Select a closed box-based mesh to use as a building layout.');
 const vertices=Object.values(layout.vertices);
 if(vertices.length>4096)throw Error('Use a simple modeling cage with fewer than 4,096 vertices.');
 if(vertices.some(v=>v.length!==3||!v.every(Number.isFinite)))throw Error('The layout contains invalid vertex coordinates.');
 const caps=[],edges=new Map();
 for(const face of layout.faces){
  const points=face.map(k=>layout.vertices[k]);
  if(points.some(v=>!v))throw Error('The layout has a face with missing vertices.');
  const fixed=[0,1,2].filter(a=>points.every(v=>Math.abs(v[a]-points[0][a])<EPS));
  if(!fixed.length)throw Error('Keep layout faces horizontal or axis-aligned vertical. Use box extrusions; slopes are not supported yet.');
  if(fixed.includes(2))caps.push(points);
  face.forEach((key,i)=>{const id=[key,face[(i+1)%face.length]].sort().join(':');edges.set(id,(edges.get(id)||0)+1);});
 }
 if([...edges.values()].some(n=>n!==2))throw Error('Close the layout mesh before applying it. Every edge must join two faces.');
 let xs=unique(vertices.map(v=>v[0])),ys=unique(vertices.map(v=>v[1]));
 if(xs.length*ys.length>16384)throw Error('Simplify the layout cage before generating a building.');
 let cells=Array.from({length:xs.length-1},(_,x)=>Array.from({length:ys.length-1},(_,y)=>{
  const cx=(xs[x]+xs[x+1])/2,cy=(ys[y]+ys[y+1])/2;
  const heights=unique(caps.filter(p=>inside(cx,cy,p)).map(p=>p[0][2]));
  if(!heights.length)return null;
  if(heights.length!==2||heights[1]-heights[0]<EPS)throw Error('The layout must be a solid building envelope without stacked cavities or overhangs.');
  return heights;
 }));
 const occupied=cells.flat().filter(Boolean);
 if(!occupied.length)throw Error('The layout has no enclosed volume.');
 const base=Math.min(...occupied.map(v=>v[0]));
 if(occupied.some(v=>Math.abs(v[0]-base)>EPS))throw Error('Keep the bottom of every wing at the same height.');
 const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 // Coplanar loop cuts do not introduce additional facade seams.
 for(let x=xs.length-2;x>0;x--)if(cells[x].every((v,y)=>equal(v,cells[x-1][y]))){xs.splice(x,1);cells.splice(x,1);}
 for(let y=ys.length-2;y>0;y--)if(cells.every(col=>equal(col[y],col[y-1]))){ys.splice(y,1);cells.forEach(col=>col.splice(y,1));}
 const subdivide=axis=>axis.flatMap((v,i)=>{
  if(i===axis.length-1)return [v];
  const count=Math.max(1,Math.round((axis[i+1]-v)/bay));
  if(!Number.isFinite(count)||count>4096)throw Error('Increase module size or reduce the layout to fewer than 4,096 roof bays.');
  return Array.from({length:count},(_,n)=>v+(axis[i+1]-v)*n/count);
 });
 const nx=subdivide(xs),ny=subdivide(ys);
 if(nx.length*ny.length>4096)throw Error('Increase module size or reduce the layout to fewer than 4,096 roof bays.');
 const cellAt=(x,y)=>cells[xs.findIndex((v,i)=>i<xs.length-1&&x>=v&&x<xs[i+1])]?.[ys.findIndex((v,i)=>i<ys.length-1&&y>=v&&y<ys[i+1])];
 return {xs:nx,ys:ny,base,heights:Array.from({length:nx.length-1},(_,x)=>Array.from({length:ny.length-1},(_,y)=>cellAt((nx[x]+nx[x+1])/2,(ny[y]+ny[y+1])/2)?.[1]??null))};
}
export function layoutInstances(p,library,add){
 const [bay,floor,ground]=library.sizes,unit=p.module_size||1;
 const {xs,ys,heights,base}=layoutGrid(p.layout,bay*unit);
 const height=(x,y)=>heights[x]?.[y]??base;
 const occupied=(x,y,z)=>height(x,y)>z+EPS;
 for(let x=0;x<xs.length-1;x++)for(let y=0;y<ys.length-1;y++){
  const top=height(x,y);if(top<=base)continue;
  const dx=xs[x+1]-xs[x],dy=ys[y+1]-ys[y],cx=(xs[x]+xs[x+1])/2,cy=(ys[y]+ys[y+1])/2;
  add(`M.B${p.style}.Roof`,[dx/bay,0,0,cx,0,dy/bay,0,cy,0,0,unit,top,0,0,0,1],'Roof');
  for(const [tx,ty,ox,oy,px,py] of [[1,0,0,-1,cx,ys[y]],[0,1,1,0,xs[x+1],cy],[-1,0,0,1,cx,ys[y+1]],[0,-1,-1,0,xs[x],cy]]){
   const bottom=height(x+ox,y+oy);if(bottom>=top-EPS)continue;
   const zmid=(bottom+top)/2;
   const corner=s=>!occupied(x+s*tx,y+s*ty,zmid)?'Ext':occupied(x+s*tx+ox,y+s*ty+oy,zmid)?'Inn':null;
   const left=corner(-1),right=corner(1);let suffix='Regular',flip=1;
   if(left&&right){suffix=left===right?`Corner-${left}2`:'Corner-Both';if(left==='Inn')flip=-1;}
   else if(left||right){suffix=`Corner-${left||right}`;if(left)flip=-1;}
   const horizontal=(tx?dx:dy)/bay;
   const matrix=(z,vertical)=>[tx*flip*horizontal,-ty*unit,0,px,ty*flip*horizontal,tx*unit,0,py,0,0,vertical,z,0,0,0,1];
   const storefront=Math.abs(bottom-base)<EPS;
   const count=Math.max(storefront?0:1,Math.round(((top-bottom)/unit-(storefront?ground:0))/floor));
   if(count>48)throw Error('Increase module size to keep each wall below 48 floors.');
   const vertical=(top-bottom)/((storefront?ground:0)+count*floor);
   if(storefront)add(`M.B${p.style}.GF.${suffix}`,matrix(bottom,vertical),'Storefronts');
   const start=bottom+(storefront?ground*vertical:0);
   for(let level=0;level<count;level++)add(`M.B${p.style}.Floor.${suffix}`,matrix(start+level*floor*vertical,vertical),'Floors');
   add(`M.B${p.style}.RoofE.${suffix}`,matrix(top-floor*vertical,vertical),'Cornice');
  }
 }
}
