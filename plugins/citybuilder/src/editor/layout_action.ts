import { renameNodes } from '../../../roadscape/src/core/network';
import { zoneSkyline, addSkylineRing } from '../core/city/skyline';
import { generateLayout, DEFAULT_LAYOUT } from '../core/city/layout';
import type { LayoutOptions } from '../core/city/layout';
import { writeNetwork } from '../../../roadscape/src/editor/network_mesh';
import { writeStoredDocument } from '../../../roadscape/src/editor/document';
import { BUILTIN_PROFILES } from '../../../roadscape/src/core/profile_library';
import type { CityController } from './controller';

export function layoutDialog(ctl:CityController):void {
	const profiles=Object.fromEntries(BUILTIN_PROFILES.map(p=>[p.id,p.name]));
	new Dialog({id:'citybuilder_layout',title:'Generate editable layout',form:{
		info:{type:'info',text:'Grows a new editable Roadscape network with a tensor-field street generator: main roads first, then streets that follow the land and avoid water and steep ground. Existing roads, terrain and zoning are retained. Move control points and handles afterwards.'},
		kind:{label:'Layout',type:'select',options:{organic:'Organic city (growth around centres)',grid:'Grid city',radial:'Radial city (rings and spokes)',circuit:'Closed circuit (race track)'},value:'organic'},
		seed:{label:'Seed',type:'number',value:ctl.store.state?.settings.seed??1,min:0,max:999999},
		blockSize:{label:'Block size (m)',type:'number',value:DEFAULT_LAYOUT.blockSize,min:30,max:300,step:5},
		coverage:{label:'Map coverage',type:'number',value:DEFAULT_LAYOUT.coverage,min:.1,max:.9,step:.05},
		centers:{label:'City centres (organic)',type:'number',value:DEFAULT_LAYOUT.centers,min:1,max:5,step:1},
		hierarchy:{label:'Main roads first',type:'checkbox',value:true},
		terrainFollow:{label:'Follow hillsides (0–1)',type:'number',value:DEFAULT_LAYOUT.terrainFollow,min:0,max:1,step:.1},
		wiggle:{label:'Street bend (0–1)',type:'number',value:DEFAULT_LAYOUT.wiggle,min:0,max:1,step:.05},
		rotation:{label:'Rotation (degrees)',type:'number',value:0,min:-180,max:180},
		profile:{label:'Street profile',type:'select',options:profiles,value:'street'},
		mainProfile:{label:'Main road profile',type:'select',options:profiles,value:'avenue'},
		elevation:{label:'Elevation above land (m)',type:'number',value:0.2,min:-100,max:200,step:.1},
		zone:{label:'Zone beside new roads',type:'checkbox',value:true},
		zonePattern:{label:'Zoning pattern',type:'select',options:{uniform:'One district',skyline:'Skyline: downtown to suburbs'},value:'uniform'},
		district:{label:'District',type:'select',options:Object.fromEntries(ctl.districts.map(d=>[d.id,d.label])),value:String(ctl.district.id)},
		zoneDepth:{label:'Zone depth (m)',type:'number',value:32,min:10,max:120}
	},onConfirm:(values:LayoutOptions)=>{void applyLayout(ctl,{...DEFAULT_LAYOUT,...values,district:Number(values.district)});}} as never).show();
}
export async function applyLayout(ctl:CityController,options:LayoutOptions):Promise<void> {
	await ctl.run('Generating editable layout',()=>{
		const state=ctl.store.state;if(!state)throw new Error('Create a city first.');
		if(!ctl.hasRoadscape)throw new Error('Load Roadscape to edit the generated network.');
		let graph=generateLayout(state.terrain,state.settings.waterLevel,state.settings.unitsPerMeter,options);
		let vertices: Record<string, [number, number, number]> = {};
		if(options.zonePattern==='skyline') {
			addSkylineRing(state,graph);
			// Lot detail is seeded from road IDs. Mesh.addVertices assigns random keys, so seed these new
			// control vertices explicitly; otherwise the same starter seed produces different buildings.
			let ordinal=0, prefix='';
			do { prefix=`skyline_${options.seed}_${ordinal++}_`; }
			while(Mesh.all.some(m=>Object.keys(m.vertices).some(key=>key.startsWith(prefix))));
			graph=renameNodes(graph,new Map([...graph.nodes.keys()].map(id=>[id,prefix+id])));
			vertices=Object.fromEntries([...graph.nodes.values()].map(n=>[n.id,[...n.position] as [number,number,number]]));
		}
		ctl.store.history.begin();
		Undo.initEdit({outliner:true,elements:[],selection:true} as never);
		let mesh:Mesh|null=null;
		try {
			mesh=new Mesh({name:`${options.kind} layout — seed ${options.seed}`,vertices,origin:[0,0,0]} as never).init() as Mesh;
			const written=writeNetwork(mesh,graph);writeStoredDocument(mesh,written.doc);
			if(options.zone) {
				const all=ctl.store.bridge.collect(state,state.settings.unitsPerMeter);
				const ids=new Set(written.network.segments.keys());
				if(options.zonePattern==='skyline')zoneSkyline(state);
				else state.districts.paintAlongRoads(all.corridors.filter(r=>ids.has(r.id)),options.district,options.zoneDepth,true);
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
