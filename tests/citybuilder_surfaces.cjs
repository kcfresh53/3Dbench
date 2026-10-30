const {app}=require('electron');
const {mkdtempSync,rmSync,mkdirSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const profile=mkdtempSync(join(tmpdir(),'3dbench-city-surfaces-'));
mkdirSync(join(profile,'thumbnails'));process.argv.push('--userData',profile);
app.requestSingleInstanceLock=()=>true;
app.on('quit',()=>rmSync(profile,{recursive:true,force:true}));
let done=false;
app.on('browser-window-created',(_,win)=>{
 win.webContents.on('did-finish-load',async()=>{
  if(done)return;done=true;
  try {
   const result=await win.webContents.executeJavaScript(`(async()=>{
    const check=(v,m)=>{if(!v)throw Error(m);},wait=ms=>new Promise(r=>setTimeout(r,ms));
    async function until(fn,label){for(let i=0;i<800;i++){if(fn())return;await wait(25);}throw Error('Timed out: '+label);}
    localStorage.setItem('startups','3');Blockbench.startup_count=3;
    if(Plugins.loading_promise)await Plugins.loading_promise;
    for(const name of ['roadscape','citybuilder'])await new Plugin().loadFromFile({path:${JSON.stringify(join(__dirname,'../plugins/'))}+name+'.js',name:name+'.js',content:''});
    newProject(Formats.free);
    const ctl=Panels.citybuilder_panel.vue.ctl;
    await ctl.create({size:65,cellSize:3,preset:'flat',seed:19});
    const state=ctl.store.state;
    state.settings.features={buildings:true,trees:false};state.settings.development=1;
    state.terrain.heights.fill(3);state.paint.data.fill(1);
    state.districts.paintBrush(0,0,80,1);
    const road=new Mesh({name:'Surface regression road',vertices:{a:[-70,3.2,-15],b:[0,3.2,-15],c:[65,3.2,30],d:[-30,3.2,-80],e:[5,3.2,55]}});
    road.roadscape_net=JSON.stringify({version:3,settings:{unitsPerMeter:1,defaultProfile:'street'},profiles:{},segments:{},nodes:{}});
    road.addFaces(...[['a','b'],['b','c'],['b','d'],['b','e']].map(vertices=>new MeshFace(road,{vertices,texture:false})));road.init();
    const manager=Panels.roadscape_panel.vue.session.manager;await manager.ready;manager.scan(true);
    ctl.store.edited(0);ctl.store.recomposeNow();
    await until(()=>ctl.store.plan.buildings.length>0,'supported buildings');
    const plan=ctl.store.plan;
    check(plan.terrain.lotWeight.some(w=>w>.5),'No building pads to check');
    const materials=ctl.display.terrain.root.children.map(o=>o.material).filter(m=>m?.isMeshStandardMaterial);
    check(materials.every(m=>!m.customProgramCacheKey().endsWith('-paved')),'Automatic pads introduced paving');
    const roads=[];Canvas.scene.traverse(o=>{if(o.name.includes('(pbr:'))roads.push(o);});
    check(roads.every(o=>!o.name.includes('pbr:paved')),'Sidewalk still uses decorative pavers');
    const concrete=roads.find(o=>o.name.includes('pbr:concrete'));
    check(concrete,'Concrete sidewalk missing');
    await until(()=>[concrete.material.map,concrete.material.normalMap,concrete.material.roughnessMap].every(t=>t.image?.width>0),'concrete PBR maps');
    check(concrete.material.map.image.width===1024&&concrete.material.map.image.height===1024,'Concrete032 preview lost source aspect ratio');
    ctl.display.setOption('districts',false);ctl.display.setOption('lots',false);
    const preview=Preview.selected,renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1280,720);
    renderer.outputEncoding=preview.renderer.outputEncoding;renderer.toneMapping=preview.renderer.toneMapping;renderer.toneMappingExposure=preview.renderer.toneMappingExposure;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    const camera=new THREE.PerspectiveCamera(55,1280/720,.1,2000);
    const capture=(position,target)=>{camera.position.fromArray(position);camera.lookAt(...target);renderer.render(Canvas.scene,camera);return renderer.domElement.toDataURL('image/png').split(',')[1];};
    window.surfaceCaptures={pads:capture([-35,24,40],[-8,3,-8]),curbs:capture([-32,6,-10],[-17,3.1,-17])};
    ctl.display.setOption('buildings',false);
    window.surfaceCaptures.junction=capture([14,45,34],[0,3,-15]);
    ctl.display.setOption('buildings',true);
    state.districts.paintBrush(0,0,80,2);ctl.store.edited(0);ctl.store.recomposeNow();
    window.surfaceCaptures.facade=capture([-35,24,40],[-8,3,-8]);
    check(renderer.info.programs.every(p=>p.diagnostics?.runnable!==false),'Surface shader failed to compile');renderer.dispose();
    return {buildings:plan.buildings.length,padsPreserveGrass:true,concretePbr:true,shaderErrors:false};
   })()`);
   const out=join(__dirname,'../.local-assets/citybuilder');mkdirSync(out,{recursive:true});
   const captures=await win.webContents.executeJavaScript('window.surfaceCaptures');
   for(const [name,bytes] of Object.entries(captures))writeFileSync(join(out,'surface-'+name+'.png'),Buffer.from(bytes,'base64'));
   console.log('CITY_SURFACES_OK',JSON.stringify(result));app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
 });
});
setTimeout(()=>{console.error('City surface test timed out');app.exit(1);},90000).unref();
import(pathToFileURL(join(__dirname,'../electron/main.js')).href).catch(e=>{console.error(e);app.exit(1);});
