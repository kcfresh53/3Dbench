import {buildBuilding as generate, materializeBuilding, DEFAULTS, STYLES, normalize} from './generator.mjs';
import LIBRARY from '../../.local-assets/buildings/library.json';
import {installLayouts} from './live-layout.js';
import {makePreview} from './preview.js';
import {openFlexi,closeFlexi,FLEXI_CSS} from './flexi.js';
const buildBuilding=values=>generate(values,LIBRARY);

let layouts;
let createAction, legacyAction, editAction, metadataProperty, activeDialog, preview, styleSheet;
let lastValues = {...DEFAULTS};
const KEY = 'procedural_building';
const DETAIL_LABELS={b1:['Window awnings %','Window plants %','Shop planters %','Shop awnings %'],b2:['Air conditioners %','Balconies %','Shop planters %','Shop awnings %'],b3:['AC units & plants %','Window awnings %','Wide shop awnings %','Corner shop awnings %']};
function selectedBuilding() {
 let group = Group.first_selected || Outliner.selected[0]?.parent;
 while (group && typeof group === 'object') {
  if (group[KEY]) return group;
  group = group.parent;
 }
}
function destroyPreview() { preview?.dispose(); preview = null; }

function createGeometry(output, existing, library=LIBRARY, version=2, source) {
 const meshes=materializeBuilding(output,library);
 const elements=[], textures=[];
 const oldElements=source?[source]:[], oldGroups=existing ? [existing] : [];
 existing?.forEachChild(child=>{if(child instanceof Group)oldGroups.push(child);else oldElements.push(child);});
 // Keep replaced textures if another building or user mesh still uses them.
 let oldTexture;
 try {oldTexture=Texture.all.find(t=>t.uuid===JSON.parse(existing?.[KEY] || '{}').texture);} catch {}
 const canRemoveTexture=oldTexture && !Outliner.elements.some(m=>!oldElements.includes(m)&&m.faces&&Object.values(m.faces).some(f=>f.texture===oldTexture.uuid));
 Undo.initEdit({outliner:true,groups:oldGroups,elements:oldElements.slice(),textures:canRemoveTexture?[oldTexture]:[],selection:true});
 try {
  const texture=new Texture({name:'Building materials · Felipe Del Rio',uv_width:library.atlas.width,uv_height:library.atlas.height}).fromDataURL(library.atlas.data).add(false);
  textures.push(texture);
  const group=existing || new Group({name:output.label || STYLES[output.params.style].label.split(' · ')[0]+' building'}).addTo(source?.parent || Outliner.ROOT).init();
  if(!existing)group.createUniqueName();
  Undo.current_save.aspects.groups=[group];
  // Regeneration replaces the contents while preserving the group's placement.
  if(existing) for(const child of [...existing.children]) child.remove();
  if(canRemoveTexture)oldTexture.remove(true);
  group[KEY]=source?'':JSON.stringify({version,params:output.params,texture:texture.uuid});
  const tw=texture.getUVWidth(), th=texture.getUVHeight();
  for(const spec of meshes) {
   const mesh=new Mesh({name:spec.name,origin:[...(source?.origin||group.origin)],rotation:source?[...source.rotation]:[0,0,0],scale:source?[...(source.scale||[1,1,1])]:[1,1,1],vertices:{},shading:'smooth'}).addTo(group);
   elements.push(mesh); // Track before initialization so error rollback also removes it.
   const keys=spec.vertices.map(v=>mesh.addVertices(v)[0]);
   for(let fi=0;fi<spec.faces.length;fi++) {
    const face=spec.faces[fi],uv={};face.forEach((i,j)=>{uv[keys[i]]=[spec.uvs[fi][j][0]*tw,spec.uvs[fi][j][1]*th];});
    mesh.addFaces(new MeshFace(mesh,{vertices:face.map(i=>keys[i]),texture:texture.uuid,uv}));
   }
   mesh.init();
  }
  if(source)source.remove();
  unselectAllElements();group.select();
  Undo.finishEdit(source?'Bake procedural building':existing?'Regenerate procedural building':'Create procedural building',{outliner:true,groups:[group],elements,textures,selection:true});
  Canvas.updateAll();
 } catch(error) {
  // Include partially created resources in the rollback reference.
  Undo.current_save.aspects.elements.push(...elements);
  Undo.current_save.aspects.textures.push(...textures);
  Undo.cancelEdit(true);throw error;
 }
}
function openGenerator(existing) {
 if(activeDialog)activeDialog.cancel();
 let values={...lastValues};
 if(existing)try {const data=JSON.parse(existing[KEY]);values=data.version===2?normalize(data.params):{...DEFAULTS};}catch{}
 const owner=Project;
 const number=(label,key,min,max,step=1)=>({label,type:'number',value:values[key],min,max,step});
 const amount=(label,key)=>({label,type:'num_slider',value:values[key],min:0,max:100,step:1});
 const labels=DETAIL_LABELS[values.style];
 const form={
  style:{label:'Building kit',type:'select',value:values.style,options:Object.fromEntries(Object.entries(STYLES).map(([id,s])=>[id,s.label]))},
  bays_x:number('Width · bays','bays_x',2,12),bays_z:number('Depth · bays','bays_z',2,12),
  floors:number('Middle floors','floors',1,12),top_floors:number('Upper floors','top_floors',1,4),
  scale:number('Overall scale','scale',0.1,10,0.1),
  extra_1:amount(labels[0],'extra_1'),extra_2:amount(labels[1],'extra_2'),
  ground_1:amount(labels[2],'ground_1'),ground_2:amount(labels[3],'ground_2'),
  seed:number('Variation seed','seed',0,2147483647),
  note:{type:'info',text:existing?'Regeneration replaces the contents of this group, including manual edits. Undo restores them.':'One storefront level is included. Width and depth count facade bays. Style changes restore that kit’s original proportions and example settings.'},
 };
 let output=buildBuilding(values),timer,lastStyle=values.style,statusNode;
 function refresh(result){
  try {output=buildBuilding(result);preview?.update(output);statusNode?.classList.remove('building_error');}
  catch(error){if(statusNode){statusNode.textContent=error.message;statusNode.classList.add('building_error');}}
 }
 const dialog=new Dialog({id:'procedural_buildings',title:existing?'Edit Procedural Building':'Procedural Buildings',width:1080,
  buttons:[existing?'Regenerate Building':'Create Building','Cancel'],part_order:['component','form'],form,
  component:{template:'<div class="building_view"><div class="building_heading"><span>MODULAR ARCHITECTURE</span><span>55 source modules</span></div><canvas ref="canvas" aria-label="Textured building preview"></canvas><p ref="status" class="building_stats"></p><p class="building_hint">Drag to orbit · Scroll to zoom · Double-click to reset</p><p class="building_credit">Architecture & materials by Felipe Del Rio · Adapted from your Blender file</p></div>',mounted(){
   statusNode=this.$refs.status;
   try {preview=makePreview(this.$refs.canvas,statusNode,LIBRARY,output);}catch(error){statusNode.textContent='Preview unavailable. You can still create the building.';console.error(error);}
  }},
  onFormChange(result){
   if(result.style!==lastStyle){lastStyle=result.style;const kit=LIBRARY.styles[lastStyle];result={...result,...STYLES[lastStyle].defaults,extra_1:kit.extras[0].amount,extra_2:kit.extras[1].amount,ground_1:kit.extras[2].amount,ground_2:kit.extras[3].amount};dialog.setFormValues(result,false);['extra_1','extra_2','ground_1','ground_2'].forEach((key,i)=>{const label=dialog.object.querySelector('.form_bar_'+key+' label');if(label)label.textContent=DETAIL_LABELS[lastStyle][i];});}
   clearTimeout(timer);timer=setTimeout(()=>refresh(result),100);
  },
  onConfirm(result){
   if(Project!==owner||(existing&&!Group.all.includes(existing))){Blockbench.showQuickMessage('The original project or building is no longer open.');return false;}
   try {output=buildBuilding(result);createGeometry(output,existing);lastValues={...output.params};}
   catch(error){console.error(error);if(statusNode){statusNode.textContent=error.message;statusNode.classList.add('building_error');}return false;}
  },
  onClose(){clearTimeout(timer);destroyPreview();activeDialog=null;queueMicrotask(()=>dialog.delete());},
 });
 activeDialog=dialog;dialog.show();
}
BBPlugin.register('procedural_buildings',{
 title:'Procedural Buildings',author:'3DBench · architecture by Felipe Del Rio',description:'Native procedural buildings: 10 FlexiBuilding styles, 50 layouts, editable footprints, palettes, fire escapes and rooftop equipment. No Blender required.',
 icon:'apartment',version:'5.0.0',variant:'both',min_version:'5.0.0',tags:['Modeling','Generator'],
 about:'Tools → Procedural Building. Self-contained native generator with bundled source modules and textures adapted from the supplied FlexiBuilding 1.0.2 file. Includes 10 styles and 50 source layouts. Legacy Building Kits retains the approved three-kit generator. No external programs or asset files are required at runtime.',
 onload(){
  layouts=installLayouts(createGeometry);
  metadataProperty=new Property(Group,'string',KEY,{default:''});
  styleSheet=Blockbench.addCSS(FLEXI_CSS+`
   #procedural_buildings .dialog_content {display:grid;grid-template-columns:minmax(300px,1fr) 340px;gap:22px;max-height:calc(100vh - 190px);overflow:auto;}
   #procedural_buildings .building_view {min-width:0;position:sticky;top:0;align-self:start;}
   #procedural_buildings .building_view canvas {width:100%;height:min(570px,calc(100vh - 330px));min-height:280px;display:block;border-radius:8px;touch-action:none;cursor:grab;}
   #procedural_buildings .building_heading {display:flex;justify-content:space-between;gap:8px;font-size:10px;letter-spacing:1px;color:var(--color-subtle_text);margin:0 0 10px;}
   #procedural_buildings .building_stats {font-size:12px;padding-top:12px;}
   #procedural_buildings .building_hint,#procedural_buildings .building_credit {font-size:11px;color:var(--color-subtle_text);padding-top:6px;}
   #procedural_buildings .building_credit {font-size:10px;padding-top:16px;}
   #procedural_buildings .building_error {color:#f2ac78;}
   #procedural_buildings .form {display:grid;grid-template-columns:1fr 1fr;column-gap:12px;align-content:start;}
   #procedural_buildings .form_bar {grid-column:span 2;}
   #procedural_buildings .form_bar_bays_x,#procedural_buildings .form_bar_bays_z,#procedural_buildings .form_bar_floors,#procedural_buildings .form_bar_top_floors {grid-column:span 1;min-width:0;}
   #procedural_buildings .dialog_bar {flex-wrap:wrap;}
   #procedural_buildings .dialog_bar > label {min-width:100%;padding-bottom:4px;}
   #procedural_buildings .dialog_bar > select {width:100%;}
   @media(max-width:800px){#procedural_buildings .dialog_content{grid-template-columns:1fr;}#procedural_buildings .building_view{position:static;}#procedural_buildings .building_view canvas{height:320px;}}
  `);
  const condition=()=>!!Project&&!!Format.meshes&&Modes.edit;
  createAction=new Action('procedural_building',{name:'Procedural Building…',icon:'apartment',category:'tools',condition,click:()=>openFlexi(null,createGeometry)});
  editAction=new Action('edit_procedural_building',{name:'Edit Procedural Building…',icon:'edit',category:'tools',condition:()=>condition()&&!!selectedBuilding(),click:()=>{const group=selectedBuilding();let version;try{version=JSON.parse(group[KEY]).version;}catch{}if(version===4)openFlexi(group,createGeometry);else openGenerator(group);}});
  legacyAction=new Action('legacy_building_kits',{name:'Legacy Building Kits…',icon:'apartment',category:'tools',condition,click:()=>openGenerator()});
  MenuBar.addAction(createAction,'tools');MenuBar.addAction(editAction,'tools');MenuBar.addAction(legacyAction,'tools');
 },
 onunload(){layouts?.dispose();closeFlexi();legacyAction?.delete();activeDialog?.cancel();destroyPreview();createAction?.delete();editAction?.delete();metadataProperty?.delete();styleSheet?.delete();},
});
