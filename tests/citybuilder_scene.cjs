const {app}=require('electron');
const {mkdtempSync,rmSync,mkdirSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');const {join}=require('node:path');const {pathToFileURL}=require('node:url');
// End-to-end check of City Builder inside the real app: create a city, draw a road with Roadscape,
// zone it, sculpt, undo, save into the project, bake and make a mesh game ready. Run with:
//   npm run test:citybuilder-scene
const profile=mkdtempSync(join(tmpdir(),'3dbench-citybuilder-'));mkdirSync(join(profile,'thumbnails'));
process.argv.push('--userData',profile);app.requestSingleInstanceLock=()=>true;
app.on('quit',()=>rmSync(profile,{recursive:true,force:true}));let done=false;
app.on('browser-window-created',(_,win)=>{
 win.webContents.on('console-message',(_, ...args)=>{if(/Error|CityBuilder/.test(JSON.stringify(args)))console.log('RENDERER',JSON.stringify(args));});
 win.webContents.on('did-finish-load',async()=>{
  if(done)return;done=true;
  try{
   const result=await win.webContents.executeJavaScript(`(async()=>{
    const check=(c,m)=>{if(!c)throw Error(m);};
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    async function until(fn,label,ticks=800){for(let i=0;i<ticks;i++){if(fn())return;await wait(25);}throw Error('Timed out: '+(label||fn));}
    await new Promise(r=>requestAnimationFrame(r));
    if(Plugins.loading_promise)await Plugins.loading_promise;
    await wait(50);
    for(const name of ['roadscape','citybuilder']){
     await new Plugin().loadFromFile({path:${JSON.stringify(join(__dirname,'../plugins/'))}+name+'.js',name:name+'.js',content:''});
     check(Plugins.registered[name]?.source==='file',name+' did not register');
    }
    newProject(Formats.free);
    const ui=Panels.citybuilder_panel.vue;check(ui&&ui.ctl,'City Builder panel missing');
    const ctl=ui.ctl;
    check(!ctl.store.state,'A new project must not contain a city');

    // ---- create: terrain, water and the project property exist ----
    await ctl.create({size:129,cellSize:6,preset:'rolling',seed:1});
    check(ctl.store.state&&ctl.store.plan,'City was not created');
    check(Project.citybuilder_doc.length>1000,'City was not stored in the project');
    check(ctl.display.root.parent===Project.model_3d,'Display is not attached to the project');
    check(ctl.display.root.no_export===true,'Live city must not be exported');

    // ---- brushed districts generate buildings without roads, including undo/redo ----
    ctl.store.state.terrain.heights.fill(2);
    ctl.store.edited(0);
    ctl.pickDistrictType(2);
    ctl.district.mode='brush';ctl.district.radius=80;
    const hit={x:0,y:2,z:-180};
    ctl.districtTool.down(hit,{detail:1});ctl.districtTool.up();
    await until(()=>ctl.store.plan.buildings.length>3,'brush buildings without roads');
    const brushed=ctl.store.plan.buildings.length;
    Undo.undo();await until(()=>ctl.store.plan.buildings.length===0,'undo brush');
    Undo.redo();await until(()=>ctl.store.plan.buildings.length===brushed,'redo brush');
    Undo.undo();await until(()=>ctl.store.plan.buildings.length===0,'clear brush for road checks');

    // ---- draw one road with Roadscape ----
    const rs=Panels.roadscape_panel.vue;await until(()=>rs.session.manager.library,'road library');
    rs.draw();const preview=Preview.selected;
    function fire(type,position,extra={}){
     const p=new THREE.Vector3(...position).project(preview.camera),rect=preview.canvas.getBoundingClientRect();
     preview.canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,clientX:rect.left+(p.x+1)*rect.width/2,clientY:rect.top+(1-p.y)*rect.height/2,button:0,pointerId:1,pointerType:'mouse',...extra}));
    }
    const click=position=>{fire('pointermove',position);fire('pointerdown',position);fire('pointerup',position);};
    preview.camera.position.set(0,500,520);preview.controls.target.set(0,0,0);preview.controls.update();preview.camera.updateMatrixWorld(true);
    click([-150,2,0]);click([0,2,0]);click([150,2,40]);
    document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await until(()=>Mesh.all.some(m=>m.roadscape_net),'road created');
    await until(()=>ctl.store.roads.corridors.length>0,'city read the road');
    check(ctl.snapshot().roadCount>0,'Panel does not count the road');

    // ---- zone along the road: lots, buildings, trees, instanced display ----
    ctl.pickDistrictType(2);ctl.zoneAllRoads();
    await until(()=>ctl.store.plan&&ctl.store.plan.buildings.length>3,'buildings appeared');
    const plan=ctl.store.plan;
    check(plan.lots.length>=plan.buildings.length&&plan.stats.population>0,'Implausible plan');
    let instanced=0;ctl.display.root.traverse(o=>{if(o.isInstancedMesh)instanced++;});
    check(instanced>0,'No instanced buildings in the display');
    const buildings=plan.buildings.length;
    Undo.undo();await until(()=>ctl.store.plan.buildings.length===0,'undo zoning');
    Undo.redo();await until(()=>ctl.store.plan.buildings.length===buildings,'redo zoning');

    // ---- growth only adds buildings ----
    ctl.setSetting('development',0.2);await until(()=>ctl.store.plan.buildings.length<buildings,'less development');
    const young=new Set(ctl.store.plan.buildings.map(b=>b.lotId));
    ctl.setSetting('development',1);await until(()=>ctl.store.plan.buildings.length>=buildings,'full development');
    const grown=new Set(ctl.store.plan.buildings.map(b=>b.lotId));
    for(const id of young)check(grown.has(id),'Growth removed a building');

    // ---- landscape tool: drag raises terrain and is undoable ----
    ctl.pickLandscape('raise');check(Toolbox.selected.id==='citybuilder_landscape','Landscape tool not selected');
    ctl.setLandscape('brush.radius',60);ctl.setLandscape('brush.strength',1);
    const hf=()=>ctl.store.state.terrain;const before=hf().sample(0,-200);
    fire('pointermove',[0,0,-200]);fire('pointerdown',[0,0,-200]);fire('pointermove',[10,0,-200]);fire('pointerup',[10,0,-200]);
    check(hf().sample(0,-200)>before+0.05,'Brush did not raise the ground');
    Undo.undo();check(Math.abs(hf().sample(0,-200)-before)<1e-3,'Undo did not restore the ground');
    Undo.redo();check(hf().sample(0,-200)>before+0.05,'Redo did not repeat the stroke');
    (BarItems.move_tool).select();

    // ---- persistence: reload from the project property gives the same city ----
    const heights=hf().heights.slice(),ids=ctl.store.state.districts.grid.data.slice();
    ctl.store.load();
    check(hf().heights.every((h,i)=>Math.abs(h-heights[i])<1e-3)&&ctl.store.state.districts.grid.data.every((v,i)=>v===ids[i]),'Saved city differs from the live city');

    // ---- bake: ordinary meshes, undoable ----
    await until(()=>ctl.store.plan,'plan after reload');
    await ctl.bake();
    check(Group.all.some(g=>g.name==='City')&&Mesh.all.filter(m=>m.name.startsWith('terrain_')).length>0,'Bake created nothing');
    check(Mesh.all.some(m=>m.name.startsWith('buildings_')),'Bake created no buildings');
    check(Mesh.all.some(m=>m.name.startsWith('trees_')),'Bake created no trees');
    const bakedMeshes=Mesh.all.length;
    Undo.undo();check(!Group.all.some(g=>g.name==='City'),'Bake undo left the group');
    Undo.redo();check(Mesh.all.length===bakedMeshes,'Bake redo failed');

    // ---- make a mesh game ready ----
    const target=Mesh.all.find(m=>m.name.startsWith('buildings_'));target.select();
    await ctl.gameReadySelection();
    check(Group.all.some(g=>g.name.endsWith('(game ready)')),'Game-ready output missing');
    check(Mesh.all.some(m=>/_LOD2/.test(m.name)),'No LOD2 mesh');

    // ---- picture for the human, then unload cleanly ----
    document.getElementById('quick_message_box')?.remove();
    preview.camera.position.set(260,230,300);preview.controls.target.set(0,0,0);preview.controls.update();ctl.display.setOption('districts',true);
    await wait(500);
    const stats=ctl.store.plan.stats;
    Plugins.registered.citybuilder.onunload();
    check(!Panels.citybuilder_panel&&!BarItems.citybuilder_landscape&&!BarItems.citybuilder_district,'Unload leaked UI');
    check(!Project.model_3d.children.some(o=>o.name==='CityBuilder live city'),'Unload leaked the display');
    return {buildings,stats};
   })()`);
   mkdirSync(join(__dirname,'../.local-assets/citybuilder'),{recursive:true});writeFileSync(join(__dirname,'../.local-assets/citybuilder/city.png'),(await win.webContents.capturePage()).toPNG());
   console.log('CITYBUILDER_OK',JSON.stringify(result));app.exit(0);
  }catch(error){console.error(error);mkdirSync(join(__dirname,'../.local-assets/citybuilder'),{recursive:true});writeFileSync(join(__dirname,'../.local-assets/citybuilder/failure.png'),(await win.webContents.capturePage()).toPNG());app.exit(1);}
 });
});
setTimeout(()=>{console.error('City Builder scene timeout');app.exit(1);},170000).unref();
import(pathToFileURL(join(__dirname,'../electron/main.js')).href).catch(e=>{console.error(e);app.exit(1);});
