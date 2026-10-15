import {loadNative,prepareNative} from './flexi-assets.js';
import {nativeOutput,NATIVE_DEFAULTS,normalizeNative} from './flexi-native.mjs';
import {makePreview} from './preview.js';
import {captureLayout} from './layout.mjs';
import MANIFEST from './flexi-manifest.json';
let dialog,preview;
export function closeFlexi(){dialog?.cancel();}
export function openFlexi(existing,createGeometry,controller){
 closeFlexi();const owner=Project;let params={...NATIVE_DEFAULTS};
 try{const data=JSON.parse(existing?.procedural_building||'{}');if(data.version===4)params=normalizeNative(data.params);}catch{}
 if(controller){try{params={...params,...JSON.parse(controller.building_layout||'{}')};}catch{}params.shape='mesh';params.scale=1;params.layout=captureLayout(controller);}
 if(!existing&&!controller)params.palette=MANIFEST.presets['Building_1-1'].inputs.Socket_20;
 let result,readyKey='',closed=false,sequence=0,timer,activeLibrary;
 const component={
  data:()=>({meshLayout:!!controller,p:params,tab:'shape',busy:false,error:false,message:'Loading bundled building assets…',tabs:{shape:'Shape',style:'Style & light',details:'Rooftop & facade'},sides:{source:'Original preset',none:'None',front:'Front',back:'Back',left:'Left',right:'Right',all:'All walls'}}),
  methods:{
   changed(){clearTimeout(timer);timer=setTimeout(()=>this.generate(),120);},
   presetChanged(){const source=MANIFEST.presets[`Building_${this.p.style}-${this.p.preset}`].inputs;this.p.palette=source.Socket_20;this.changed();},
   async generate(){
    const token=++sequence;this.busy=true;this.error=false;
    try{
     if(controller)this.p.layout=captureLayout(controller);
     const p=normalizeNative(this.p),key=JSON.stringify(p);const source=await loadNative(p.style);const output=nativeOutput(p,source);const library=await prepareNative(source,p);
     if(closed||token!==sequence)return;
     if(preview&&activeLibrary===library)preview.update(output);else{preview?.dispose();preview=makePreview(this.$refs.canvas,this.$refs.stats,library,output);activeLibrary=library;}
     result={output,library};readyKey=key;this.message='Drag to orbit · Scroll to zoom · Double-click to reset';
    }catch(error){if(!closed&&token===sequence){this.error=true;this.message=error.message;}}
    finally{if(!closed&&token===sequence)this.busy=false;}
   },
  },mounted(){this.generate();},
  template:`<div class="flexi_layout"><div class="flexi_view"><div class="flexi_heading">FLEXIBUILDING <span>Native 3DBench generator</span></div><canvas ref="canvas"></canvas><p ref="stats"></p><p :class="{flexi_error:error}" role="status">{{busy?'Updating preview…':message}}</p><p class="flexi_hint">10 source styles · 50 original layouts · Editable meshes<br>Architecture by Felipe Del Rio</p></div>
   <div class="flexi_settings"><nav><button v-for="(label,id) in tabs" :class="{active:tab===id}" @click="tab=id">{{label}}</button></nav>
    <div v-if="tab==='shape'" class="flexi_fields">
     <label>Building style<select v-model.number="p.style" @change="presetChanged"><option v-for="n in 10" :value="n">Style {{n}}</option></select></label>
     <label v-if="!meshLayout">Original layout<select v-model.number="p.preset" @change="presetChanged"><option v-for="n in 5" :value="n">Layout {{n}}</option></select></label>
     <p v-if="meshLayout" class="flexi_hint">Live mesh layout: model the control mesh with loop cuts and face extrusions. The building follows its footprint and height. Keep faces axis-aligned and the base flat. Bake to meshes before exporting.</p><label v-if="meshLayout">Module size<input type="number" min="0.1" max="100" step="0.1" v-model.number="p.module_size" @input="changed"></label><label v-if="!meshLayout">Footprint<select v-model="p.shape" @change="changed"><option value="preset">Original preset shape</option><option value="rectangle">Rectangle</option><option value="l">L-shaped</option><option value="u">U-shaped</option><option value="courtyard">Courtyard</option></select></label>
     <template v-if="!meshLayout && p.shape!=='preset'"><label>Width · bays<input type="number" min="2" max="16" v-model.number="p.width" @input="changed"></label><label>Depth · bays<input type="number" min="2" max="16" v-model.number="p.depth" @input="changed"></label><label>Floors above storefront<input type="number" min="1" max="24" v-model.number="p.floors" @input="changed"></label></template>
     <label v-if="!meshLayout">Overall scale<input type="number" min="0.1" max="10" step="0.1" v-model.number="p.scale" @input="changed"></label>
     <label>Plain walls<select v-model="p.plain" @change="changed"><option v-for="(name,id) in sides" :value="id">{{name}}</option></select></label>
     <label>Fire escapes<select v-model="p.stairs" @change="changed"><option v-for="(name,id) in sides" :value="id">{{name}}</option></select></label>
    </div>
    <div v-if="tab==='style'" class="flexi_fields"><label>Color palette<select v-model.number="p.palette" @change="changed"><option v-for="n in 5" :value="n">Palette {{n}}</option></select></label><label>Lit window bays · {{p.lit}}%<input type="range" min="0" max="100" v-model.number="p.lit" @input="changed"></label><label>Window light color<input type="color" v-model="p.light_color" @input="changed"></label><label>Light brightness<input type="range" min="0" max="2" step="0.1" v-model.number="p.light_intensity" @input="changed"></label><label>Variation seed<input type="number" min="0" max="2147483647" v-model.number="p.seed" @input="changed"></label><p class="flexi_hint">Palettes recolor the baked source materials. Window lighting is baked into the generated texture; reflections and moving parallax are not live shaders.</p></div>
    <div v-if="tab==='details'" class="flexi_fields"><label v-if="p.shape==='preset'"><input type="checkbox" v-model="p.source_details" @change="changed">Keep original preset accessories</label><div v-if="!p.source_details || p.shape!=='preset'" class="flexi_fields"><label>Rooftop coverage · {{p.roof_amount}}%<input type="range" min="0" max="100" v-model.number="p.roof_amount" @input="changed"></label><label>Air conditioners · {{p.ac}}%<input type="range" min="0" max="100" v-model.number="p.ac" @input="changed"></label><label>Water tanks<input type="number" min="0" max="10" v-model.number="p.tanks" @input="changed"></label><label>Antennas<input type="number" min="0" max="10" v-model.number="p.antennas" @input="changed"></label><label><input type="checkbox" v-model="p.hvac" @change="changed">HVAC systems</label><label><input type="checkbox" v-model="p.access" @change="changed">Rooftop access</label><label><input type="checkbox" v-model="p.hatches" @change="changed">Roof hatches</label><label><input type="checkbox" v-model="p.solar" @change="changed">Solar panels</label><label><input type="checkbox" v-model="p.skylights" @change="changed">Skylights</label></div><p v-else class="flexi_hint">The creator’s original accessory placements are preserved. Turn this off to generate a seeded arrangement.</p></div>
   </div></div>`,
 };
 dialog=new Dialog({id:'flexibuilding',title:controller?'Live Building Layout':existing?'Edit FlexiBuilding':'Procedural Buildings · FlexiBuilding',width:1120,component,buttons:[controller?'Apply Live Building':existing?'Regenerate Building':'Create Building','Cancel'],onConfirm(){
  const vm=dialog.content_vue;if(vm.busy||!result||JSON.stringify(normalizeNative(vm.p))!==readyKey){vm.message='Wait for the current preview before creating the building.';vm.error=true;return false;}
  if(Project!==owner||(existing&&!Group.all.includes(existing))||(controller&&!Mesh.all.includes(controller))){vm.message='The original project or building is no longer open.';vm.error=true;return false;}
  try{createGeometry(result.output,controller||existing,result.library,4);}catch(error){vm.message=error.message;vm.error=true;return false;}
 },onClose(){closed=true;++sequence;clearTimeout(timer);preview?.dispose();preview=null;const old=dialog;dialog=null;queueMicrotask(()=>old.delete());}});dialog.show();
}
export const FLEXI_CSS=`
 #flexibuilding .flexi_layout{display:grid;grid-template-columns:minmax(300px,1fr) 350px;gap:24px;max-height:calc(100vh - 210px);overflow:auto}
 #flexibuilding .flexi_view{position:sticky;top:0;align-self:start;min-width:0}
 #flexibuilding canvas{display:block;width:100%;height:min(570px,calc(100vh - 350px));min-height:260px;background:#252e38;border-radius:8px;touch-action:none}
 #flexibuilding .flexi_heading{font-size:13px;letter-spacing:1px;margin:0 0 12px}#flexibuilding .flexi_heading span{float:right;font-size:10px;color:var(--color-subtle_text)}
 #flexibuilding p{margin:12px 0;font-size:12px}#flexibuilding .flexi_hint{font-size:11px;color:var(--color-subtle_text);line-height:1.5}#flexibuilding .flexi_error{color:#f2ac78}
 #flexibuilding nav{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:18px}#flexibuilding nav button{font-size:12px;padding:6px 10px}#flexibuilding nav .active{background:var(--color-accent);color:var(--color-accent_text)}
 #flexibuilding .flexi_fields{display:grid;gap:14px}#flexibuilding label{display:grid;gap:6px;font-size:12px}#flexibuilding input,#flexibuilding select{max-width:100%;width:100%}#flexibuilding input[type=checkbox]{width:20px;height:20px}#flexibuilding input[type=color]{height:30px}
 @media(max-width:800px){#flexibuilding .flexi_layout{grid-template-columns:1fr}#flexibuilding .flexi_view{position:static}}
`;
