const {app}=require('electron');
const {mkdtempSync,rmSync,mkdirSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const profile=mkdtempSync(join(tmpdir(),'3dbench-skyline-'));
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
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const check=(v,m)=>{if(!v)throw Error(m);};
    // This isolated profile tests the city, so skip the asynchronous first-run welcome panel.
    localStorage.setItem('startups','3');Blockbench.startup_count=3;
    if(Plugins.loading_promise)await Plugins.loading_promise;
    await wait(700);
    for(const name of ['roadscape','citybuilder'])await new Plugin().loadFromFile({path:${JSON.stringify(join(__dirname,'../plugins/'))}+name+'.js',name:name+'.js',content:''});
    newProject(Formats.free);
    const ctl=Panels.citybuilder_panel.vue.ctl;
    await ctl.createSkyline(8);
    await wait(100);ctl.store.recomposeNow();
    const plan=ctl.store.plan;
    check(plan.buildings.length>100,'Starter has too few buildings: '+plan.buildings.length);
    const shapes=[...new Set(plan.buildings.map(b=>b.spec.shape))];
    for(const shape of ['rounded','chamfered','tapered','sail'])check(shapes.includes(shape),'Missing '+shape);
    let pbr=0;ctl.display.root.traverse(o=>{if(o.isInstancedMesh&&o.material.isMeshStandardMaterial&&o.material.normalMap&&o.material.roughnessMap&&o.material.envMap)pbr++;});
    check(pbr>0,'PBR building materials missing');
    const road=Mesh.all.find(m=>m.name.startsWith('organic layout'));
    check(road,'Editable roads missing');
    check(Object.keys(road.vertices).every(id=>id.startsWith('skyline_8_0_')),'Seeded road identifiers were randomized');
    const count=plan.buildings.length;
    Undo.undo();await wait(50);ctl.store.recomposeNow();
    check(!Mesh.all.includes(road)&&ctl.store.plan.buildings.length===0,'Starter layout undo failed');
    Undo.redo();await wait(50);ctl.store.recomposeNow();
    check(ctl.store.plan.buildings.length===count,'Starter layout redo changed buildings');
    const preview=Preview.selected;
    preview.camera.position.set(780,580,1020);preview.controls.target.set(0,25,-110);preview.controls.update();preview.camera.updateMatrixWorld(true);
    ctl.display.setOption('districts',false);ctl.display.setOption('lots',false);
    document.getElementById('quick_message_box')?.remove();
    for(let i=0;ctl.display.terrain.textureSize<2048 && i<1500;i++)await wait(25);
    await wait(400);
    check(ctl.display.terrain.textureSize===2048,'Terrain texture bake did not finish');
    check(plan.buildings.some(b=>b.spec.archetype==='wind_turbine'),'Wind farm missing');
    window.skylineProject=Codecs.project.compile();
    window.skylineCapture=(()=>{
     const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1568,588);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
     const camera=new THREE.PerspectiveCamera(36,1568/588,1,20000);camera.position.set(450,300,650);camera.lookAt(0,40,-120);
     renderer.render(Canvas.scene,camera);const image=renderer.domElement.toDataURL('image/png').split(',')[1];renderer.dispose();return image;
    })();
    const signature=JSON.stringify(ctl.store.plan.buildings);
    newProject(Formats.free);await wait(100);
    await ctl.createSkyline(8);await wait(100);ctl.store.recomposeNow();
    check(JSON.stringify(ctl.store.plan.buildings)===signature,'Same seed did not reproduce the same buildings');
    return {buildings:count,shapes,pbr,trees:plan.trees.length,roadSegments:ctl.snapshot().roadCount,reproducible:true};
   })()`);
   const out=join(__dirname,'../.local-assets/citybuilder');mkdirSync(out,{recursive:true});
   writeFileSync(join(out,'river-skyline.bench'),await win.webContents.executeJavaScript('window.skylineProject'));
   writeFileSync(join(out,'skyline-reference-view.png'),Buffer.from(await win.webContents.executeJavaScript('window.skylineCapture'),'base64'));
   writeFileSync(join(out,'skyline.png'),(await win.webContents.capturePage()).toPNG());
   console.log('SKYLINE_OK',JSON.stringify(result));app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
 });
});
setTimeout(()=>{console.error('Skyline scene timed out');app.exit(1);},240000).unref();
import(pathToFileURL(join(__dirname,'../electron/main.js')).href).catch(e=>{console.error(e);app.exit(1);});
