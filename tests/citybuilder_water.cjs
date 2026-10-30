const {app}=require('electron');
const {mkdtempSync,rmSync,mkdirSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const profile=mkdtempSync(join(tmpdir(),'3dbench-city-water-'));
mkdirSync(join(profile,'thumbnails'));process.argv.push('--userData',profile);
app.requestSingleInstanceLock=()=>true;
app.on('quit',()=>rmSync(profile,{recursive:true,force:true}));
let done=false;
app.on('browser-window-created',(_,win)=>{
 win.webContents.on('console-message',(_, ...args)=>{if(/Error|CityBuilder/.test(JSON.stringify(args)))console.log('RENDERER',JSON.stringify(args));});
 win.webContents.on('did-finish-load',async()=>{
  if(done)return;done=true;
  try {
   const result=await win.webContents.executeJavaScript(`(async()=>{
    const check=(v,m)=>{if(!v)throw Error(m);};
    localStorage.setItem('startups','3');Blockbench.startup_count=3;
    if(Plugins.loading_promise)await Plugins.loading_promise;
    await new Plugin().loadFromFile({path:${JSON.stringify(join(__dirname,'../plugins/citybuilder.js'))},name:'citybuilder.js',content:''});
    newProject(Formats.free);
    const ctl=Panels.citybuilder_panel.vue.ctl;
    await ctl.create({size:65,cellSize:4,preset:'flat',seed:19,kind:'landscape'});
    const state=ctl.store.state,hf=state.terrain;
    state.settings.features={buildings:false,trees:false};state.settings.waterLevel=0;
    Object.assign(state.settings.water,{animate:false,color:[.02,.18,.8],colorRatio:1,alphaScale:1,normal:0,foamIntensity:0,shoreFadeDistance:.1});
    for(let r=0;r<hf.rows;r++)for(let c=0;c<hf.cols;c++){
     const x=hf.worldX(c),z=hf.worldZ(r),coast=84-Math.hypot(x,z);
     let h=Math.max(-6,Math.min(5,coast));
     for(const p of [[-24,0],[28,16]])h=Math.min(h,Math.max(-4,(Math.hypot(x-p[0],z-p[1])-14)*1.5));
     hf.set(c,r,h);
    }
    for(let r=0;r<state.paint.rows;r++)for(let c=0;c<state.paint.cols;c++)state.paint.set(c,r,(Math.floor(c/8)+Math.floor(r/8))%10+1);
    hf.touch();ctl.store.edited(0);ctl.store.recomposeNow();ctl.store.flush();
    const originalHeights=hf.heights.slice(),originalLevel=state.settings.waterLevel;
    // Reopen a version-1 city with the former export defaults, as an old project would.
    const doc=JSON.parse(Project.citybuilder_doc);doc.settings.gameReady.atlasSize=2048;doc.settings.gameReady.texelsPerMeter=32;
    Project.citybuilder_doc=JSON.stringify(doc);ctl.store.load();
    check(ctl.store.state.terrain.heights.every((h,i)=>Math.abs(h-originalHeights[i])<.001),'Reload changed authored terrain');
    check(ctl.store.state.settings.waterLevel===originalLevel,'Reload changed the water level');
    const preview=Preview.selected;
    const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(512,512);
    renderer.outputEncoding=preview.renderer.outputEncoding;renderer.toneMapping=preview.renderer.toneMapping;renderer.toneMappingExposure=preview.renderer.toneMappingExposure;
    const camera=new THREE.OrthographicCamera(-170,170,170,-170,.1,500);camera.position.set(0,200,0);camera.up.set(0,0,-1);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
    const target=new THREE.WebGLRenderTarget(512,512),pixels=new Uint8Array(512*512*4);
    const capture=()=>{renderer.setRenderTarget(target);renderer.render(Canvas.scene,camera);renderer.readRenderTargetPixels(target,0,0,512,512,pixels);return pixels.slice();};
    const sample=(data,x,z)=>{const p=new THREE.Vector3(x,0,z).project(camera),px=Math.floor((p.x+1)*256),py=Math.floor((p.y+1)*256);return Array.from(data.slice((py*512+px)*4,(py*512+px)*4+3));};
    const wet=capture();
    ctl.display.updateWater();
    ctl.store.state.settings.water.show=false;ctl.display.updateWater();const dry=capture();
    ctl.store.state.settings.water.show=true;ctl.display.updateWater();
    const probes={};
    for(const [name,x,z,isWater] of [['puddleA',-24,0,true],['puddleB',28,16,true],['coast',110,0,true],['ocean',150,0,true],['dryRidge',0,0,false],['dryLand',0,50,false]]){
     const a=sample(wet,x,z),b=sample(dry,x,z);probes[name]={water:a,withoutWater:b};
     if(isWater)check(a[2]>a[0]+45&&a.some((v,i)=>Math.abs(v-b[i])>20),name+' water hidden by terrain: '+JSON.stringify(probes[name]));
     else check(a.every((v,i)=>Math.abs(v-b[i])<=2),name+' incorrectly covered by water: '+JSON.stringify(probes[name]));
    }
    check(renderer.info.programs.every(p=>p.diagnostics?.runnable!==false),'Water/terrain shader did not compile');
    renderer.setRenderTarget(null);renderer.render(Canvas.scene,camera);window.waterRegressionCapture=renderer.domElement.toDataURL('image/png').split(',')[1];
    target.dispose();renderer.dispose();
    const level=ctl.store.state.settings.waterLevel,heights=ctl.store.state.terrain.heights;
    check(heights.every((h,i)=>Math.abs(h-originalHeights[i])<.001)&&level===originalLevel,'Rendering changed project data');
    return {probes,legacyReload:true,heightsPreserved:true};
   })()`);
   const out=join(__dirname,'../.local-assets/citybuilder');mkdirSync(out,{recursive:true});
   writeFileSync(join(out,'water-regression.png'),Buffer.from(await win.webContents.executeJavaScript('window.waterRegressionCapture'),'base64'));
   console.log('CITY_WATER_OK',JSON.stringify(result));app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
 });
});
setTimeout(()=>{console.error('City water test timed out');app.exit(1);},90000).unref();
import(pathToFileURL(join(__dirname,'../electron/main.js')).href).catch(e=>{console.error(e);app.exit(1);});
