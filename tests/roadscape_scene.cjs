const {app}=require('electron');
const {mkdtempSync,rmSync,mkdirSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');const {join}=require('node:path');const {pathToFileURL}=require('node:url');
const profile=mkdtempSync(join(tmpdir(),'3dbench-roadscape-'));mkdirSync(join(profile,'thumbnails'));
process.argv.push('--userData',profile);app.requestSingleInstanceLock=()=>true;
app.on('quit',()=>rmSync(profile,{recursive:true,force:true}));let done=false;
app.on('browser-window-created',(_,win)=>{
 win.webContents.on('console-message',(_, ...args)=>{if(/Error|Roadscape/.test(JSON.stringify(args)))console.log('RENDERER',JSON.stringify(args));});
 win.webContents.on('did-finish-load',async()=>{
  if(done)return;done=true;
  try{
   const result=await win.webContents.executeJavaScript(`(async()=>{
    const check=(c,m)=>{if(!c)throw Error(m);};
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    async function until(fn,label){for(let i=0;i<600;i++){if(fn())return;await wait(25);}throw Error('Timed out: '+(label||fn));}
    await new Promise(r=>requestAnimationFrame(r));
    if(Plugins.loading_promise)await Plugins.loading_promise;
    await wait(50);
    check(!Plugins.registered.roadscape,'Roadscape must not be built in');
    await new Plugin().loadFromFile({path:${JSON.stringify(join(__dirname,'../plugins/roadscape.js'))},name:'roadscape.js',content:''});
    check(Plugins.registered.roadscape?.source==='file','Standalone plugin did not register');
    newProject(Formats.free);
    const ui=Panels.roadscape_panel.vue;
    check(ui&&!open_interface,'Missing sidebar or modal opened');
    check(getComputedStyle(ui.$el).overflowY==='auto','Sidebar cannot scroll');
    const networks=()=>Mesh.all.filter(m=>m.roadscape_net);
    const body=mesh=>mesh.mesh.children.find(o=>o.name==='Roadscape live surface');
    const triangles=mesh=>{let n=0;body(mesh)?.children.forEach(c=>n+=c.geometry.attributes.position.count/3);return n;};

    // ---- drawing: clicks build nothing until finished, then one undoable network ----
    ui.draw();check(Toolbox.selected.id==='roadscape_draw','Drawing tool not selected');
    const preview=Preview.selected;
    function clickWorld(position,modifiers={}){
     const p=new THREE.Vector3(...position).project(preview.camera),rect=preview.canvas.getBoundingClientRect();
     const options={bubbles:true,clientX:rect.left+(p.x+1)*rect.width/2,clientY:rect.top+(1-p.y)*rect.height/2,button:0,pointerId:1,pointerType:'mouse',...modifiers};
     preview.canvas.dispatchEvent(new PointerEvent('pointerdown',options));preview.canvas.dispatchEvent(new PointerEvent('pointerup',options));
    }
    const key=name=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:name,bubbles:true}));
    clickWorld([0,0,-30]);clickWorld([0,0,0]);clickWorld([0,0,40]);
    check(!Mesh.all.length&&!Texture.all.length,'Drawing mutated the project before finishing');
    key('Enter');
    await until(()=>networks().length===1,'network created');
    let road=networks()[0];
    check(Object.keys(road.vertices).length===3,'Clicks did not create three points');
    await until(()=>body(road),'live road');
    check(!Texture.all.length&&Mesh.all.length===1,'Live road added baked resources');
    const first=triangles(road);check(first>0&&first<4000,'Default road has an unreasonable triangle count: '+first);

    // ---- a second road across the first splits both and forms a junction ----
    check(Toolbox.selected.id==='roadscape_draw','Tool should stay active for the next road');
    clickWorld([-40,0,15]);clickWorld([40,0,15]);key('Enter');
    await until(()=>Object.keys(road.vertices).length===6,'junction vertices');
    check(Object.values(road.faces).filter(f=>f.vertices.length===2).length===5,'Crossing did not split into five roads');
    await until(()=>triangles(road)>first,'junction geometry');
    Undo.undo();check(Object.keys(road.vertices).length===3,'Undo did not remove the second road');
    Undo.redo();check(Object.keys(road.vertices).length===6,'Redo did not restore the junction');
    key('Escape');key('Escape');check(Toolbox.selected.id!=='roadscape_draw','Escape should leave the tool');

    // ---- editing road type, side stack and settings through the sidebar ----
    road.select();BarItems.selection_mode.set('vertex');
    road.getSelectedVertices(true).splice(0,Infinity,...Object.keys(road.vertices));updateSelection();await wait(80);
    ui.pickProfile('tree_street');
    await until(()=>JSON.parse(road.roadscape_net).segments&&Object.values(JSON.parse(road.roadscape_net).segments).every(s=>s.profile==='tree_street'),'profile applied');
    await until(()=>road.mesh.children.some(o=>o.name==='Roadscape live surface'&&o.children.length>=2),'procedural trees in the live road');
    const doc=()=>JSON.parse(road.roadscape_net);
    ui.addLining('left','guardrail');
    await until(()=>Object.keys(doc().profiles).length===1,'type copied into the project');
    const custom=Object.values(doc().profiles)[0];
    check(custom.left.some(e=>e.type==='guardrail')&&!custom.builtin,'Edit did not fork the library type');
    ui.setSettings({budget:{maxTriangles:3200,enforce:true}});
    await until(()=>triangles(road)<=3200,'budget thinning');
    check(!Undo.current_save,'Sidebar left an undo transaction open');

    // ---- save, reload, and survive ----
    const project=Codecs.project.compile({raw:true});newProject(Formats.free);Codecs.project.parse(project);
    road=networks()[0];await until(()=>body(road),'live road after reload');
    check(doc().settings.budget.enforce===true&&Object.keys(doc().profiles).length===1,'Saved road settings were lost');

    // ---- older single-path roads open as networks ----
    const legacy=new Mesh({name:'old road',vertices:{},origin:[0,0,0]}).init();
    const keys=[[80,0,0],[80,0,40],[100,0,80]].map(p=>legacy.addVertices(p)[0]);
    legacy.addFaces(new MeshFace(legacy,{vertices:[keys[0],keys[1]],texture:false}),new MeshFace(legacy,{vertices:[keys[1],keys[2]],texture:false}));
    legacy.roadscape_live=JSON.stringify({version:2,params:{preset:'highway',width:10,lanes:2,scale:1},start:keys[0]});
    Canvas.updateView({elements:[legacy],element_aspects:{geometry:true,faces:true}});
    await until(()=>body(legacy)&&triangles(legacy)>0,'migrated road');

    // ---- bake: component meshes, atlases, undo ----
    road.select();
    const originalAdd=Mesh.prototype.addFaces;let injected=false;
    Mesh.prototype.addFaces=function(...args){if(!injected){injected=true;throw Error('Injected bake failure');}return originalAdd.apply(this,args);};
    await Panels.roadscape_panel.vue.bake().catch(()=>{});await wait(300);
    Mesh.prototype.addFaces=originalAdd;
    check(networks().includes(road)&&Group.all.length===0&&!Undo.current_save,'Failed bake leaked resources or lost the network');
    road.select();road.rotation=[0,25,0];road.origin=[3,1,5];Mesh.preview_controller.updateTransform(road);await until(()=>body(road));
    body(road).updateWorldMatrix(true,false);const before=new THREE.Box3().setFromObject(body(road));
    ui.bake();await until(()=>!networks().includes(road)&&Group.all.length===1&&!Undo.current_save,'baked');
    const after=new THREE.Box3();for(const m of Mesh.all.filter(m=>!m.roadscape_net&&!m.roadscape_live)){m.mesh.updateWorldMatrix(true,false);m.mesh.geometry.computeBoundingBox();after.union(m.mesh.geometry.boundingBox.clone().applyMatrix4(m.mesh.matrixWorld));}
    check(before.min.distanceTo(after.min)<.01&&before.max.distanceTo(after.max)<.01,'Bake changed the road transform or bounds');
    check(Texture.all.length>=2,'Bake should add a road atlas and a tree atlas');
    const baked=Mesh.all.filter(m=>!m.roadscape_live).length;check(baked>5,'Bake produced too few component meshes');
    const gltf=JSON.parse(await Codecs.gltf.compile({encoding:'ascii',embed_textures:true,animations:false}));
    check(gltf.meshes.length>=baked&&gltf.images.length>=2,'Baked export lost geometry or atlases');
    Undo.undo();road=networks().find(m=>m.vertices&&Object.keys(m.vertices).length===6);check(road&&Group.all.length===0,'Bake undo lost the network');
    await until(()=>body(road),'live road after bake undo');
    Undo.redo();check(!networks().includes(road),'Bake redo failed');
    Undo.undo();road=networks().find(m=>Object.keys(m.vertices).length===6);road.select();await until(()=>body(road));

    // ---- unloading restores native controls; reloading recreates the derived road ----
    Plugins.registered.roadscape.onunload();
    check(!BarItems.roadscape_draw&&!Panels.roadscape_panel,'Unload leaked tools or panel');
    check(!road.mesh.children.some(o=>o.name==='Roadscape live surface'),'Unload leaked geometry');
    Plugins.registered.roadscape.onload();road.select();await until(()=>body(road),'live road after plugin reload');
    document.getElementById('quick_message_box')?.remove();
    body(road).updateWorldMatrix(true,false);const center=new THREE.Box3().setFromObject(body(road)).getCenter(new THREE.Vector3());
    Preview.selected.controls.target.copy(center);Preview.selected.camera.position.copy(center.clone().add(new THREE.Vector3(70,55,70)));Preview.selected.controls.update();await wait(250);
    return {source:Plugins.registered.roadscape.source,initialTriangles:first,networkPoints:Object.keys(road.vertices).length,bakedMeshes:baked,gltfMeshes:gltf.meshes.length};
   })()`);
   mkdirSync(join(__dirname,'../.local-assets/roadscape'),{recursive:true});writeFileSync(join(__dirname,'../.local-assets/roadscape/network.png'),(await win.webContents.capturePage()).toPNG());
   console.log('ROADSCAPE_NETWORK_OK',JSON.stringify(result));app.exit(0);
  }catch(error){console.error(error);mkdirSync(join(__dirname,'../.local-assets/roadscape'),{recursive:true});writeFileSync(join(__dirname,'../.local-assets/roadscape/failure.png'),(await win.webContents.capturePage()).toPNG());app.exit(1);}
 });
});
setTimeout(()=>{console.error('Roadscape timeout');app.exit(1);},120000).unref();
import(pathToFileURL(join(__dirname,'../electron/main.js')).href).catch(e=>{console.error(e);app.exit(1);});
