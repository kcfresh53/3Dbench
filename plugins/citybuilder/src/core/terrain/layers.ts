import type { CityPlan } from '../city/compose';
import type { CitySettings } from '../city/settings';
import { Raster } from '../raster';
import { clamp, saturate } from '../math';
import { SURFACES } from './surfaces';
import { terrainMaterial, terrainTint } from '../../texture/terrain_tiles';

export interface TerrainLayers {
	origin: number[];
	size: number[];
	/** Sample masks at (worldXZ - origin) / size with clamped linear filtering. */
	masks: string[];
	stochastic: {algorithm:'triangular-offset-rotation-v1';seed:number;cellScale:number};
	entries: Array<{surface:string; material:string; mask:number; channel:number; tint:number[]}>;
}

/** Engine-ready splat maps retain world-scale 4K detail without enormous baked world textures. */
export function terrainLayers(plan: CityPlan, settings: CitySettings): {manifest:TerrainLayers;files:Array<{path:string;raster:Raster;dataTexture:boolean}>} {
	const hf = plan.terrain.heights, count = SURFACES.length + 1;
	const sizeX = hf.cellCols * 2, sizeZ = hf.cellRows * 2;
	const maps = Array.from({length:Math.ceil(count / 4)}, () => new Raster(sizeX,sizeZ));
	const paths = maps.map((_,i) => `terrain/layers_${i}.png`);
	const weights = new Float64Array(count);
	for(let y=0;y<sizeZ;y++) for(let x=0;x<sizeX;x++) {
		weights.fill(0);
		const fc=(x+.5)/sizeX*hf.cellCols, fr=(y+.5)/sizeZ*hf.cellRows;
		const cc=fc-.5, cr=fr-.5, c=Math.floor(cc), r=Math.floor(cr), u=cc-c, v=cr-r;
		for(const [dx,dz,w] of [[0,0,(1-u)*(1-v)],[1,0,u*(1-v)],[0,1,(1-u)*v],[1,1,u*v]]) {
			const id=plan.surfaces.get(clamp(c+dx,0,hf.cellCols-1),clamp(r+dz,0,hf.cellRows-1));
			weights[id>0 && id<=SURFACES.length?id-1:0]+=w;
		}
		const vc=Math.floor(fc), vr=Math.floor(fr), tu=fc-vc, tv=fr-vr, a=hf.index(vc,vr);
		const sample=(array:Float32Array):number => (array[a]*(1-tu)+array[a+1]*tu)*(1-tv)+(array[a+hf.cols]*(1-tu)+array[a+hf.cols+1]*tu)*tv;
		const road=saturate((sample(plan.terrain.roadbedWeight)-.6)*4);
		// Level pads support buildings without turning the surrounding yard into paving.
		// Paving is a deliberate painted surface, independent of terrain conformation.
		for(let i=0;i<SURFACES.length;i++) weights[i]*=1-road;
		weights[count-1]=road;
		let total=0, largest=0;
		for(let i=0;i<count;i++) {
			if(weights[i]>weights[largest])largest=i;
			const value=Math.round(weights[i]*255); total+=value;
			maps[Math.floor(i/4)].data[(y*sizeX+x)*4+i%4]=value;
		}
		maps[Math.floor(largest/4)].data[(y*sizeX+x)*4+largest%4]+=255-total;
	}
	return {files:maps.map((raster,i)=>({path:paths[i],raster,dataTexture:true})),manifest:{
		origin:[hf.originX,hf.originZ],size:[hf.width,hf.depth],masks:paths,
		stochastic:{algorithm:'triangular-offset-rotation-v1',seed:settings.seed,cellScale:.75},
		entries:[...SURFACES.map((surface,i)=>({surface,material:terrainMaterial[surface],mask:Math.floor(i/4),channel:i%4,tint:terrainTint[surface]??[1,1,1]})),
			{surface:'roadbed',material:'asphalt',mask:Math.floor((count-1)/4),channel:(count-1)%4,tint:[1,1,1]}],
	}};
}
