import PACKS from '../../.local-assets/flexibuilding/native/packs.json';
const cache=new Map(),prepared=new Map();
export async function loadNative(style){
 if(!cache.has(style))cache.set(style,(async()=>{const bytes=Uint8Array.from(atob(PACKS[style]),c=>c.charCodeAt(0));return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();})());
 const pending=cache.get(style);if(cache.size>3)cache.delete(cache.keys().next().value);return pending;
}
const image=url=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('Could not decode the bundled building texture.'));im.src=url;});
const srgb=v=>v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055;
const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
export async function prepareNative(library,params){
 const key=[params.style,params.palette,params.light_color,params.light_intensity].join(':');if(prepared.has(key))return prepared.get(key);
 const width=library.atlas.width,height=library.atlas.height,canvas=document.createElement('canvas');canvas.width=width*2;canvas.height=height;
 const ctx=canvas.getContext('2d',{willReadFrequently:true}),im=await image(library.atlases[0]);ctx.drawImage(im,0,0);const pixels=ctx.getImageData(0,0,width,height),data=pixels.data;
 const base=library.palettes[0],palette=library.palettes[params.palette-1];
 function raster(uv,visit){
  const points=uv.map(([u,v])=>[u*width,(1-v)*height]);
  for(let i=1;i<points.length-1;i++){
   const [a,b,c]=[points[0],points[i],points[i+1]],cross=(p,q,x,y)=>(q[0]-p[0])*(y-p[1])-(q[1]-p[1])*(x-p[0]);
   const sign=Math.sign(cross(a,b,...c));if(!sign)continue;
   const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),x1=Math.min(width-1,Math.ceil(Math.max(a[0],b[0],c[0]))),y0=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),y1=Math.min(height-1,Math.ceil(Math.max(a[1],b[1],c[1])));
   for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(cross(a,b,x+.5,y+.5)*sign>=0&&cross(b,c,x+.5,y+.5)*sign>=0&&cross(c,a,x+.5,y+.5)*sign>=0)visit((y*width+x)*4);
  }
 }
 if(params.palette!==1)for(const module of Object.values(library.modules))for(let i=0;i<module.faces.length;i++){
  const material=module.materials[i];if(!/FlexiBLD_(Painted|Bricks|Concrete|MetalCustom|SmokedGlass|Roof)$/.test(material))continue;
  const a=base[module.color_keys[i]],b=palette[module.color_keys[i]];if(!a||!b)continue;
  raster(module.uvs[i],offset=>{for(let c=0;c<3;c++)data[offset+c]=Math.round(Math.max(0,Math.min(1,srgb(linear(data[offset+c]/255)*(b[c]+.015)/(a[c]+.015))))*255);});
 }
 ctx.putImageData(pixels,0,0);ctx.putImageData(pixels,width,0);
 const warm=(params.light_color.match(/[a-f\d]{2}/gi)||['ff','d3','99']).map(v=>parseInt(v,16)/255),strength=params.light_intensity;
 for(const module of Object.values(library.modules))for(let i=0;i<module.faces.length;i++)if(/Parallax|SmokedGlass/.test(module.materials[i]))raster(module.uvs[i],offset=>{
  for(let c=0;c<3;c++){const v=data[offset+c]/255;data[offset+c]=Math.round(255*Math.min(1,v*.55+warm[c]*(.22+.28*strength)));}
 });
 ctx.putImageData(pixels,width,0);
 const modules={};
 for(const [name,m] of Object.entries(library.modules)){
  modules[name]={...m,uvs:m.uvs.map(face=>face.map(([u,v])=>[u*.5,v]))};
  modules[name+'#lit']={...m,uvs:m.uvs.map(face=>face.map(([u,v])=>[u*.5+.5,v]))};
 }
 const result={...library,modules,atlas:{width:width*2,height,data:canvas.toDataURL('image/png')}};
 prepared.set(key,result);if(prepared.size>3)prepared.delete(prepared.keys().next().value);return result;
}
