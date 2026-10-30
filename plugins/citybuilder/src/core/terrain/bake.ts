import type { CityPlan } from '../city/compose';
import type { CitySettings } from '../city/settings';
import { paintTerrain } from './paint';
import { buildPatch, patchRanges } from './mesh';
import type { Raster } from '../raster';
import type { TerrainPatch } from './mesh';

/** Independent padded chunk maps preserve local detail without a giant world atlas. */
export function* terrainBakePieces(plan: CityPlan, settings: CitySettings): Generator<{name:string; patch:TerrainPatch; raster:Raster; orm?:Raster; normal?:Raster; texture:string}> {
	const hf=plan.terrain.heights, size=settings.terrainTexture;
	const input={hf,surfaces:plan.surfaces,roadWeight:plan.terrain.roadbedWeight,lotWeight:plan.terrain.lotWeight,
		padColor:[136,146,118] as [number,number,number],waterLevel:settings.waterLevel,sun:settings.sun,size,seed:settings.seed};
	const single=settings.terrainTextureMode==='single';
	const shared=single?paintTerrain(input):null;
	const sharedOrm=single && settings.gameReady.pbr?paintTerrain({...input,channel:'orm'}):undefined;
	const sharedNormal=single && settings.gameReady.pbr?paintTerrain({...input,channel:'normal'}):undefined;
	for(const r of patchRanges(hf,32)) {
		const name=`chunk_${r.c0}_${r.r0}`;
		const patch=buildPatch(hf,r.c0,r.r0,r.c1,r.r1);
		const width=(r.c1-r.c0)*hf.cellSize, depth=(r.r1-r.r0)*hf.cellSize;
		const border=2, usable=size-2*border;
		const region={x:hf.worldX(r.c0)-width*border/usable,z:hf.worldZ(r.r0)-depth*border/usable,width:width*size/usable,depth:depth*size/usable};
		if(!single) for(let i=0;i<patch.uvs.length;i+=2) {
			patch.uvs[i]=(patch.positions[i/2*3]-region.x)/region.width;
			patch.uvs[i+1]=(patch.positions[i/2*3+2]-region.z)/region.depth;
		}
		yield {name,patch,raster:shared??paintTerrain({...input,region}),
			orm:settings.gameReady.pbr?(sharedOrm??paintTerrain({...input,region,channel:'orm'})):undefined,
			normal:settings.gameReady.pbr?(sharedNormal??paintTerrain({...input,region,channel:'normal'})):undefined,
			texture:single?'albedo':`albedo_${r.c0}_${r.r0}`};
	}
}
