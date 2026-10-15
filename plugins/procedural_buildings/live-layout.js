import {captureLayout} from './layout.mjs';
import {loadNative,prepareNative} from './flexi-assets.js';
import {nativeOutput} from './flexi-native.mjs';
import {makeInstances} from './instances.js';
import {openFlexi} from './flexi.js';
const KEY='building_layout';
export function installLayouts(createGeometry){
 const property=new Property(Mesh,'string',KEY,{default:''}),states=new Map(),listeners=[],actions=[];
 const faceMaterial=new THREE.MeshBasicMaterial({color:0x65b8ff,transparent:true,opacity:.18,depthTest:false,depthWrite:false,side:THREE.DoubleSide});
 const outlineMaterial=Canvas.meshOutlineMaterial.clone();outlineMaterial.depthTest=false;
 const vertexMaterial=Canvas.meshVertexMaterial.clone();vertexMaterial.depthTest=false;
 const invisible=new THREE.MeshBasicMaterial({visible:false,side:THREE.DoubleSide});
 let disposed=false;
 function clear(mesh){
  const state=states.get(mesh);if(!state)return;
  clearTimeout(state.timer);state.token++;state.renderer?.dispose();
  state.overlay?.removeFromParent();state.overlay?.geometry.dispose();
  if(state.object?.outline)state.object.outline.material=Canvas.meshOutlineMaterial;
  if(state.object?.vertex_points)state.object.vertex_points.material=Canvas.meshVertexMaterial;
  if(state.object?.material===invisible)state.object.material=state.material;
  states.delete(mesh);
 }
 function selection(mesh,state){
  state.overlay?.removeFromParent();state.overlay?.geometry.dispose();state.overlay=null;
  if(!state.output)return;
  mesh.mesh.outline.material=outlineMaterial;
  mesh.mesh.vertex_points.material=vertexMaterial;
  const positions=[];
  if(mesh.selected&&BarItems.selection_mode.value==='face')for(const key of mesh.getSelectedFaces()){
   const face=mesh.faces[key];if(!face)continue;const keys=face.getSortedVertices();
   for(let i=1;i<keys.length-1;i++)for(const k of [keys[0],keys[i],keys[i+1]])positions.push(...mesh.vertices[k]);
  }
  if(positions.length){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));state.overlay=new THREE.Mesh(geometry,faceMaterial);state.overlay.no_export=true;state.overlay.renderOrder=10;mesh.mesh.add(state.overlay);}
 }
 function hideCage(mesh,state){
  if(mesh.mesh.material!==invisible)state.material=mesh.mesh.material;
  mesh.mesh.material=invisible;
 }
 async function update(mesh,state){
  const token=++state.token,owner=Project;
  try{
   const params={...JSON.parse(mesh[KEY]),shape:'mesh',scale:1,layout:captureLayout(mesh)};
   const key=JSON.stringify(params);if(key===state.key&&state.object===mesh.mesh){hideCage(mesh,state);return;}
   const source=await loadNative(params.style),output=nativeOutput(params,source),library=await prepareNative(source,params);
   if(disposed||token!==state.token||Project!==owner||!Mesh.all.includes(mesh)||!mesh[KEY])return;
   if(state.library!==library){state.renderer?.dispose();state.renderer=makeInstances(library);state.library=library;}
   const group=state.renderer.update(output);mesh.mesh.add(group);hideCage(mesh,state);
   state.key=key;state.object=mesh.mesh;state.output=output;state.error='';selection(mesh,state);
  }catch(error){
   if(disposed||token!==state.token||Project!==owner)return;
   state.renderer?.dispose();state.renderer=null;state.library=null;state.output=null;state.key='';
   if(state.object?.material===invisible)state.object.material=state.material;
   if(state.error!==error.message)Blockbench.showQuickMessage('Building layout: '+error.message,6000);
   state.error=error.message;selection(mesh,state);
   mesh.mesh.outline.material=Canvas.meshOutlineMaterial;mesh.mesh.vertex_points.material=Canvas.meshVertexMaterial;
  }
 }
 function schedule(mesh){
  if(!mesh[KEY]){clear(mesh);return;}
  let state=states.get(mesh);if(!state){state={token:0,object:mesh.mesh,material:mesh.mesh?.material};states.set(mesh,state);}
  state.token++;if(state.timer)return;
  state.timer=setTimeout(()=>{state.timer=null;update(mesh,state);},70);
 }
 function scan(){
  for(const mesh of states.keys())if(!Mesh.all.includes(mesh)||!mesh[KEY])clear(mesh);
  for(const mesh of Mesh.all)if(mesh[KEY])schedule(mesh);
 }
 const watch=(target,event,cb)=>listeners.push(target.on(event,cb));
 watch(Mesh.preview_controller,'setup update_geometry',({element})=>schedule(element));
 watch(Mesh.preview_controller,'update_selection',({element})=>{const s=states.get(element);if(s)selection(element,s);});
 watch(Mesh.preview_controller,'update_faces',({element})=>{const s=states.get(element);if(s?.output)hideCage(element,s);});
 watch(Mesh.preview_controller,'remove',({element})=>clear(element));
 watch(Blockbench,'finished_edit undo redo select_project load_project',scan);
 watch(Blockbench,'unselect_project',()=>{for(const mesh of states.keys())clear(mesh);});
 const selected=()=>Mesh.selected.length===1?Mesh.selected[0]:null;
 const condition=()=>!!Project&&Format.meshes&&Modes.edit&&!!selected();
 function apply(output,mesh){
  Undo.initEdit({elements:[mesh]});
  const {layout,...params}=output.params;mesh[KEY]=JSON.stringify(params);
  Undo.finishEdit('Apply live procedural building');schedule(mesh);
 }
 function action(id,name,click,linked){
  const a=new Action(id,{name,icon:'apartment',category:'tools',condition:()=>condition()&&(linked?!!selected()[KEY]:!selected()[KEY]),click});
  Mesh.prototype.menu.addAction(a,0);MenuBar.addAction(a,'tools');actions.push(a);
 }
 action('building_layout_apply','Use Mesh as Building Layout…',()=>openFlexi(null,apply,selected()));
 action('building_layout_edit','Edit Live Building…',()=>openFlexi(null,apply,selected()),true);
 action('building_layout_remove','Remove Live Building',()=>{const mesh=selected();Undo.initEdit({elements:[mesh]});mesh[KEY]='';clear(mesh);Undo.finishEdit('Remove live procedural building');Canvas.updateAll();},true);
 action('building_layout_bake','Bake Building to Meshes',async()=>{
  const mesh=selected(),owner=Project,signature=JSON.stringify({vertices:mesh.vertices,faces:captureLayout(mesh).faces,settings:mesh[KEY]});
  try{
   const p={...JSON.parse(mesh[KEY]),shape:'mesh',scale:1,layout:captureLayout(mesh)};
   const source=await loadNative(p.style),output=nativeOutput(p,source),library=await prepareNative(source,p);
   if(Project!==owner||!Mesh.all.includes(mesh)||signature!==JSON.stringify({vertices:mesh.vertices,faces:captureLayout(mesh).faces,settings:mesh[KEY]}))throw Error('The layout changed while baking. Try again.');
   createGeometry(output,null,library,4,mesh);
  }catch(error){Blockbench.showQuickMessage(error.message,6000);}
 },true);
 scan();
 return {dispose(){disposed=true;listeners.forEach(l=>l.delete());for(const mesh of states.keys())clear(mesh);actions.forEach(a=>{Mesh.prototype.menu.removeAction(a);a.delete();});invisible.dispose();faceMaterial.dispose();outlineMaterial.dispose();vertexMaterial.dispose();property.delete();}};
}
