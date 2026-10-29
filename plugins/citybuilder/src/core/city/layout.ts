import { addNode, addSegment, createNetwork } from '../../../../roadscape/src/core/network';
import type { RoadNetwork } from '../../../../roadscape/src/core/model';
import type { Heightfield } from '../terrain/heightfield';
import { Rng } from '../math';
export interface LayoutOptions {
	kind:'grid'|'organic'|'circuit'; seed:number; blocks:number; coverage:number; rotation:number;
	profile:string; elevation:number; zone:boolean; district:number; zoneDepth:number;
}
export const DEFAULT_LAYOUT:LayoutOptions={kind:'organic',seed:1,blocks:4,coverage:0.65,rotation:0,profile:'street',elevation:0.2,zone:true,district:2,zoneDepth:32};
/** A deterministic control graph, never a baked road mesh. All coordinates remain editable. */
export function generateLayout(hf:Heightfield,waterLevel:number,unit:number,options:LayoutOptions):RoadNetwork {
	const blocks=Math.max(2,Math.min(10,Math.round(options.blocks))), coverage=Math.max(.1,Math.min(.85,options.coverage));
	const angle=options.rotation*Math.PI/180;
	const width=Math.min(hf.width,hf.depth)*coverage/(Math.abs(Math.cos(angle))+Math.abs(Math.sin(angle)));
	const network=createNetwork({unitsPerMeter:unit,defaultProfile:options.profile,seed:options.seed});
	const rng=new Rng(options.seed);
	const point=(id:string,x:number,z:number)=>{
		const xx=x*Math.cos(angle)-z*Math.sin(angle),zz=x*Math.sin(angle)+z*Math.cos(angle);
		const y=Math.max(hf.sample(xx,zz),waterLevel+1.5)+options.elevation;
		addNode(network,id,[xx*unit,y*unit,zz*unit]);
	};
	if(options.kind==='circuit') {
		const count=blocks*8;
		for(let i=0;i<count;i++) {
			const t=i/count*Math.PI*2;
			const radius=1+0.08*Math.sin(t*3+options.seed);
			point(`p${i}`,Math.cos(t)*width*.48*radius,Math.sin(t)*width*.32*radius);
		}
		for(let i=0;i<count;i++)addSegment(network,`p${i}`,`p${(i+1)%count}`);
	} else {
		const spacing=width/blocks, jitter=options.kind==='organic'?spacing*.18:0;
		for(let r=0;r<=blocks;r++)for(let c=0;c<=blocks;c++)point(`${c}:${r}`,-width/2+c*spacing+rng.range(-jitter,jitter),-width/2+r*spacing+rng.range(-jitter,jitter));
		for(let r=0;r<=blocks;r++)for(let c=0;c<=blocks;c++) {
			if(c<blocks)addSegment(network,`${c}:${r}`,`${c+1}:${r}`);
			if(r<blocks)addSegment(network,`${c}:${r}`,`${c}:${r+1}`);
		}
	}
	return network;
}
