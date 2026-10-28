// Renders generated road scenes (front faces only, so winding mistakes show up as holes).
import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const [,, libPath, scenesPath, outPng, ...names] = process.argv;
const lib = JSON.parse(readFileSync(libPath,'utf8'));
const scenes = JSON.parse(readFileSync(scenesPath,'utf8'));
const three = readFileSync('/home/claude/rs/node_modules/three/build/three.min.js','utf8');
const list = names.length ? names : Object.keys(scenes);
const html = `<html><body style="margin:0;background:#8fb4d6"><canvas id=c></canvas><script>${three}</script><script>
const atlasUrl=${JSON.stringify(lib.atlas)};const size=${lib.atlasSize};
const scenes=${JSON.stringify(Object.fromEntries(list.map(n=>[n,scenes[n]])))};const names=${JSON.stringify(list)};
function geo(parts){const pos=[],uv=[];for(const p of parts){for(const f of p.faces){for(let i=1;i<f.indices.length-1;i++)for(const j of [0,i,i+1]){pos.push(...p.positions[f.indices[j]]);uv.push(...f.uvs[j]);}}}
const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();return g;}
const cellW=700,cellH=520,W=cellW*2,rows=names.length;
const renderer=new THREE.WebGLRenderer({canvas:document.getElementById('c'),antialias:true,preserveDrawingBuffer:true});renderer.setSize(W,cellH*rows);renderer.setScissorTest(true);renderer.setClearColor(0x8fb4d6);
const img=new Image();img.onload=()=>{
 const tex=new THREE.Texture(img);tex.flipY=false;tex.needsUpdate=true;tex.magFilter=THREE.NearestFilter;
 const mat=new THREE.MeshLambertMaterial({map:tex,side:THREE.FrontSide,alphaTest:0.5});
 const wmat=new THREE.MeshBasicMaterial({color:0x111111,wireframe:true});
 const scene=new THREE.Scene();scene.add(new THREE.AmbientLight(0xffffff,.6));const d=new THREE.DirectionalLight(0xffffff,.8);d.position.set(30,60,20);scene.add(d);
 renderer.clear();
 names.forEach((n,row)=>{const g=geo(scenes[n].parts);g.computeBoundingBox();const bb=g.boundingBox,c=bb.getCenter(new THREE.Vector3()),sz=bb.getSize(new THREE.Vector3()),r=Math.max(sz.x,sz.z)*.5*${process.env.ZOOM||1};c.set(${process.env.CX||0}+c.x*0,c.y,${process.env.CZ||0}+c.z*0);
  const m=new THREE.Mesh(g,mat);const w=new THREE.Mesh(g,wmat);
  const views=[{top:true},{dir:[0.8,0.7,1.0]}];
  views.forEach((v,i)=>{let cam;if(v.top){const h=r*1.1;cam=new THREE.OrthographicCamera(-h*cellW/cellH,h*cellW/cellH,h,-h,-500,500);cam.position.set(c.x,200,c.z);cam.up.set(0,0,-1);cam.lookAt(c.x,0,c.z);}
   else{cam=new THREE.PerspectiveCamera(35,cellW/cellH,.1,1000);const dir=new THREE.Vector3(...v.dir).normalize();cam.position.copy(c).addScaledVector(dir,r*3);cam.lookAt(c);}
   renderer.setViewport(i*cellW,(rows-1-row)*cellH,cellW,cellH);renderer.setScissor(i*cellW,(rows-1-row)*cellH,cellW,cellH);
   scene.add(m);renderer.render(scene,cam);scene.remove(m);
   if(i===0){scene.add(w);renderer.autoClear=false;scene.remove(w);renderer.autoClear=true;}});
  const lab=document.createElement('div');lab.textContent=n+' '+scenes[n].triangles+' tris';lab.style.cssText='position:absolute;left:4px;top:'+(row*cellH+2)+'px;color:#fff;font:13px sans-serif;background:#0009;padding:1px 4px';document.body.appendChild(lab);});
 window.done=true;};
img.src=atlasUrl;
</script></body></html>`;
writeFileSync('/tmp/scene_page.html', html);
const browser = await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport:{width:1400,height:520*list.length}});
page.on('console', m=>console.log('console',m.text()));page.on('pageerror',e=>console.log('pageerror',e.message));
await page.goto('file:///tmp/scene_page.html');
await page.waitForFunction('window.done===true',{timeout:90000});
await page.screenshot({path: outPng, fullPage:true});
await browser.close();
console.log('wrote', outPng);
