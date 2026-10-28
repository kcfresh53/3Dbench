const {app,BrowserWindow}=require('electron');
const {join}=require('node:path');
const {mkdirSync,writeFileSync}=require('node:fs');
const root=join(__dirname,'..');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1200,height:700,webPreferences:{nodeIntegration:true,contextIsolation:false}});
 try {
  const {build}=await import('esbuild');
  const result=await build({stdin:{contents:`export {treeAsset,treeKey} from './plugins/citybuilder/src/editor/tree_assets'; export {addTreesToPackage} from './plugins/citybuilder/src/editor/tree_export'; export {buildGamePackage} from './plugins/citybuilder/src/core/gameready/package'; export {composeCity} from './plugins/citybuilder/src/core/city/compose'; export {flatCity} from './plugins/citybuilder/tests/helpers'; export {geometryForParts} from './plugins/roadscape/src/editor/live_render';`,resolveDir:root},bundle:true,write:false,format:'iife',globalName:'CityTreeTest'});
  await win.loadURL('data:text/html,<html><body style="margin:0;background:%23384044"></body></html>');
  await win.webContents.executeJavaScript(`window.THREE=require(${JSON.stringify(require.resolve('three'))});void 0;`);
  await win.webContents.executeJavaScript(result.outputFiles[0].text);
  const data=await win.webContents.executeJavaScript(`(async()=>{
   const check=(v,m)=>{if(!v)throw Error(m);};
   const samples=[]; const assets=[];
   for(const preset of ['oak_realistic','pine_realistic','birch_realistic','palm_realistic']) {
    for(const representation of ['model','cross']) {
     const t={preset,representation,variant:0,x:0,y:0,z:0,yaw:0,scale:1};
     const asset=await CityTreeTest.treeAsset(t);samples.push(t);assets.push(asset);
     const n=asset.part.faces.reduce((n,f)=>n+f.indices.length-2,0);
     check(n>0&&n<=1800,'Tree exceeds budget');
     if(representation==='cross')check(n===4,'Cross must be four triangles');
     const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=asset.dataUrl;});
     const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
     const pixels=ctx.getImageData(0,0,c.width,c.height).data;
     let solid=0,clear=0;for(let i=3;i<pixels.length;i+=4){if(pixels[i]>128)solid++;else clear++;}
     check(solid>100&&(representation==='model'||clear>100),'Missing cutout alpha or empty atlas: '+preset+' '+representation);
    }
   }
   const state=CityTreeTest.flatCity();state.settings.terrainTexture=512;
   const plan=CityTreeTest.composeCity(state,{corridors:[],junctions:[]});plan.trees=samples;
   const pkg=CityTreeTest.buildGamePackage(plan,state);await CityTreeTest.addTreesToPackage(pkg,samples);
   check(Object.keys(pkg.manifest.treeAssets).length===8,'Export lost assets');
   for(const t of pkg.manifest.trees){const a=pkg.manifest.treeAssets[t.asset];check(pkg.files.some(f=>f.path===a.mesh)&&pkg.files.some(f=>f.path===a.texture),'Export reference missing');}
   const scene=new THREE.Scene();scene.background=new THREE.Color(0x384044);
   for(let i=0;i<assets.length;i++){
    const texture=await new Promise(resolve=>new THREE.TextureLoader().load(assets[i].dataUrl,resolve));texture.flipY=false;
    const mesh=new THREE.Mesh(CityTreeTest.geometryForParts([assets[i].part]),new THREE.MeshBasicMaterial({map:texture,alphaTest:.45,side:THREE.DoubleSide}));
    mesh.position.x=(i-3.5)*12;scene.add(mesh);
   }
   const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1600,400);
   const camera=new THREE.OrthographicCamera(-52,52,19,-7,.1,200);camera.position.set(0,10,80);camera.lookAt(0,6,0);renderer.render(scene,camera);
   return {png:renderer.domElement.toDataURL('image/png'),files:pkg.files.length,trees:samples.length};
  })()`);
  const dir=join(root,'.local-assets/citybuilder');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'trees.png'),Buffer.from(data.png.split(',')[1],'base64'));
  console.log('CITY_TREES_OK',JSON.stringify({trees:data.trees,files:data.files}));app.exit(0);
 }catch(e){console.error(e);app.exit(1);}
});
setTimeout(()=>{console.error('Tree scene timeout');app.exit(1);},120000).unref();
