// Renders before/after prop comparisons with the real atlas.
import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const [,, libPath, optPath, outPng, ...names] = process.argv;
const lib = JSON.parse(readFileSync(libPath,'utf8'));
const opt = JSON.parse(readFileSync(optPath,'utf8'));
const three = readFileSync('/home/claude/rs/node_modules/three/build/three.min.js','utf8');
const list = names.length ? names : Object.keys(opt);
const html = `<html><body style="margin:0;background:#2b2f36"><canvas id=c></canvas><script>${three}</script><script>
const atlasUrl=${JSON.stringify(lib.atlas)};const materials=${JSON.stringify(lib.materials)};const size=${lib.atlasSize};
const before=${JSON.stringify(Object.fromEntries(list.map(n=>[n,lib.objects[n]||opt[n]])))};
const after=${JSON.stringify(Object.fromEntries(list.map(n=>[n,opt[n]])))};
const names=${JSON.stringify(list)};
function geo(prop,wire){const pos=[],uv=[];let tris=0;for(const f of prop.faces){const t=materials[f.material].tile;for(let i=1;i<f.indices.length-1;i++){tris++;for(const j of [0,i,i+1]){pos.push(...prop.positions[f.indices[j]]);const u=f.uvs[j];uv.push(t[0]+Math.min(1,Math.max(0,u[0]))*t[2],t[1]+Math.min(1,Math.max(0,u[1]))*t[2]);}}}
const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();return {g,tris};}
const W=1500,cellW=250,cellH=250,rows=names.length*2;
const renderer=new THREE.WebGLRenderer({canvas:document.getElementById('c'),antialias:true,preserveDrawingBuffer:true});renderer.setSize(W,cellH*rows);renderer.setScissorTest(true);renderer.setClearColor(0x2b2f36);
const img=new Image();img.onload=()=>{
 const tex=new THREE.Texture(img);tex.flipY=false;tex.needsUpdate=true;
 const mat=new THREE.MeshLambertMaterial({map:tex,side:THREE.DoubleSide});const wmat=new THREE.MeshBasicMaterial({color:0xffe08a,wireframe:true});
 const scene=new THREE.Scene();scene.add(new THREE.AmbientLight(0xffffff,.55));const d=new THREE.DirectionalLight(0xffffff,.9);d.position.set(3,5,4);scene.add(d);
 renderer.clear();
 let row=0;
 for(const n of names){for(const [set,label] of [[before,'before'],[after,'after']]){
  const {g,tris}=geo(set[n]);g.computeBoundingBox();const bb=g.boundingBox,c=bb.getCenter(new THREE.Vector3()),sz=bb.getSize(new THREE.Vector3()),r=sz.length()*.62;
  const m=new THREE.Mesh(g,mat);const w=new THREE.Mesh(g,wmat);scene.add(m);
  const views=[[1,.7,1],[-1,.5,1],[0,1.6,.4],[1,0,0.01],[0.01,0,1]];
  views.forEach((v,i)=>{const cam=new THREE.PerspectiveCamera(32,1,.01,100);const dir=new THREE.Vector3(...v).normalize();cam.position.copy(c).addScaledVector(dir,r*3.2);cam.up.set(0,1,0);cam.lookAt(c);
   renderer.setViewport(i*cellW,(rows-1-row)*cellH,cellW,cellH);renderer.setScissor(i*cellW,(rows-1-row)*cellH,cellW,cellH);
   if(i===4){scene.remove(m);scene.add(w);renderer.render(scene,cam);scene.remove(w);scene.add(m);}else renderer.render(scene,cam);});
  scene.remove(m);
  const lab=document.createElement('div');lab.textContent=n+' '+label+' '+tris+' tris';lab.style.cssText='position:absolute;left:4px;top:'+(row*cellH+2)+'px;color:#fff;font:12px sans-serif;background:#0009;padding:1px 4px';document.body.appendChild(lab);row++;
 }}
 window.done=true;};
img.src=atlasUrl;
</script></body></html>`;
writeFileSync('/tmp/props_page.html', html);
const browser = await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport:{width:1500,height:250*list.length*2}});
page.on('console', m=>console.log('console',m.text()));page.on('pageerror',e=>console.log('pageerror',e.message));
await page.goto('file:///tmp/props_page.html');
await page.waitForFunction('window.done===true',{timeout:60000});
await page.screenshot({path: outPng, fullPage:true});
await browser.close();
console.log('wrote', outPng);
