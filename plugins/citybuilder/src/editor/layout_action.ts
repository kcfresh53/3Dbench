import { generateLayout, DEFAULT_LAYOUT } from '../core/city/layout';
import type { LayoutOptions } from '../core/city/layout';
import { writeNetwork } from '../../../roadscape/src/editor/network_mesh';
import { writeStoredDocument } from '../../../roadscape/src/editor/document';
import { BUILTIN_PROFILES } from '../../../roadscape/src/core/profile_library';
import type { CityController } from './controller';

export function layoutDialog(ctl:CityController):void {
	const profiles=Object.fromEntries(BUILTIN_PROFILES.map(p=>[p.id,p.name]));
	new Dialog({id:'citybuilder_layout',title:'Generate editable layout',form:{
		info:{type:'info',text:'Adds a new editable Roadscape network. Existing roads, terrain and zoning are retained. Move control points and handles afterward to shape your streets, ramps or circuit.'},
		kind:{label:'Layout',type:'select',options:{grid:'Grid streets',organic:'Organic streets',circuit:'Closed circuit'},value:'organic'},
		seed:{label:'Seed',type:'number',value:ctl.store.state?.settings.seed??1,min:0,max:999999},
		blocks:{label:'Blocks / circuit detail',type:'number',value:4,min:2,max:10,step:1},
		coverage:{label:'Map coverage',type:'number',value:0.65,min:.1,max:.85,step:.05},
		rotation:{label:'Rotation (degrees)',type:'number',value:0,min:-180,max:180},
		profile:{label:'Road profile',type:'select',options:profiles,value:'street'},
		elevation:{label:'Elevation above land (m)',type:'number',value:0.2,min:-100,max:200,step:.1},
		zone:{label:'Zone beside new roads',type:'checkbox',value:true},
		district:{label:'District',type:'select',options:Object.fromEntries(ctl.districts.map(d=>[d.id,d.label])),value:String(ctl.district.id)},
		zoneDepth:{label:'Zone depth (m)',type:'number',value:32,min:10,max:120}
	},onConfirm:(values:LayoutOptions)=>{void applyLayout(ctl,{...DEFAULT_LAYOUT,...values,district:Number(values.district)});}} as never).show();
}
export async function applyLayout(ctl:CityController,options:LayoutOptions):Promise<void> {
	await ctl.run('Generating editable layout',()=>{
		const state=ctl.store.state;if(!state)throw new Error('Create a city first.');
		if(!ctl.hasRoadscape)throw new Error('Load Roadscape to edit the generated network.');
		const graph=generateLayout(state.terrain,state.settings.waterLevel,state.settings.unitsPerMeter,options);
		ctl.store.history.begin();
		Undo.initEdit({outliner:true,elements:[],selection:true} as never);
		let mesh:Mesh|null=null;
		try {
			mesh=new Mesh({name:`${options.kind} layout — seed ${options.seed}`,vertices:{},origin:[0,0,0]} as never).init() as Mesh;
			const written=writeNetwork(mesh,graph);writeStoredDocument(mesh,written.doc);
			if(options.zone) {
				const all=ctl.store.bridge.collect(state,state.settings.unitsPerMeter);
				const ids=new Set(written.network.segments.keys());
				state.districts.paintAlongRoads(all.corridors.filter(r=>ids.has(r.id)),options.district,options.zoneDepth,true);
			}
			ctl.store.history.commit('Generate editable city layout',{outliner:true,elements:[mesh],selection:true});
			Canvas.updateView({elements:[mesh],element_aspects:{geometry:true,faces:true},selection:true} as never);
			ctl.store.edited(0);
			ctl.say(`Added ${graph.segments.size} editable road segments. Select the network in the Outliner to move points or change profiles. Undo removes this layout and its new zoning.`);
		} catch(error) {
			ctl.store.history.discard();
			if(mesh)mesh.remove();
			Undo.cancelEdit(true);throw error;
		}
	});
}
