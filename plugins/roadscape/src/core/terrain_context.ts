import type { Vec3 } from './types';
import type { ResolvedStructure } from './structures';

export interface RoadTerrain {
	revision: string;
	groundAt(x:number,z:number): number;
	autoStructure(points:Vec3[]): ResolvedStructure;
}
export interface TerrainRules { waterLevel:number; gapHeight:number; minSpan:number; autoBridges:boolean }
/** Classifies a whole editable control edge. A sustained gap matters even when its mean height is low. */
export function terrainStructure(points: Vec3[], groundAt:(x:number,z:number)=>number, rules:TerrainRules): ResolvedStructure {
	let run=0, underground=0, total=0;
	for(let i=0;i<points.length;i++) {
		const p=points[i], h=groundAt(p[0],p[2]);
		const length=i?Math.hypot(p[0]-points[i-1][0],p[2]-points[i-1][2]):0;
		if(!Number.isFinite(h)) {run=0;continue;}
		total+=length;
		if(p[1]<h-rules.gapHeight)underground+=length;
		const gap=p[1]-h>rules.gapHeight;
		const water=h<rules.waterLevel-0.1 && p[1]>rules.waterLevel+0.1;
		run=gap||water?run+length:0;
		if(rules.autoBridges && run>=rules.minSpan)return 'bridge';
	}
	return total>0&&underground>total*0.6?'tunnel':'ground';
}
