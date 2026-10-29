import type { Vec2, Vec3 } from '../types';
import type { BuildingModel, BuildingSpec, ModelPiece } from './types';
import { tileRef } from './tiles';

/** A static, game-exportable wind turbine: tapered mast, nacelle and three swept blades. */
export function buildTurbine(spec: BuildingSpec): BuildingModel {
	const pieces: ModelPiece[] = [];
	const uv: Vec2[] = [[0,1],[1,1],[1,0],[0,0]];
	const add = (corners: Vec3[], kind: 'wall' | 'metal' | 'trim' = 'wall'): void => {
		pieces.push({ corners, uvs: corners.length === 3 ? [[0,1],[1,1],[.5,0]] : uv, tile: tileRef(kind, 14), tag: 'prop', maxLod: 2 });
	};
	for (let i=0;i<12;i++) {
		const a=i*Math.PI/6,b=(i+1)*Math.PI/6;
		add([[Math.cos(b)*1.6,0,Math.sin(b)*1.6],[Math.cos(a)*1.6,0,Math.sin(a)*1.6],[Math.cos(a)*.7,48,Math.sin(a)*.7],[Math.cos(b)*.7,48,Math.sin(b)*.7]]);
	}
	// Six nacelle faces, ordered outward.
	const box = [[-1.4,47,-4],[1.4,47,-4],[1.4,50,-4],[-1.4,50,-4],[-1.4,47,3],[1.4,47,3],[1.4,50,3],[-1.4,50,3]] as Vec3[];
	for (const face of [[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[3,7,6,2],[0,1,5,4]]) add(face.map(i=>box[i]));
	for(let blade=0;blade<3;blade++) {
		const angle=blade*Math.PI*2/3 + spec.seed*.37;
		const point=(radial:number,tangent:number,z:number):Vec3=>[Math.sin(angle)*radial+Math.cos(angle)*tangent,48.5+Math.cos(angle)*radial-Math.sin(angle)*tangent,z];
		const profile:Vec2[]=[[1,.7],[5,1.5],[23,.2],[23,-.25],[4,-.9]];
		const front=profile.map(([r,t])=>point(r,t,-4.2)), back=profile.map(([r,t])=>point(r,t,-3.85));
		for(let i=1;i<profile.length-1;i++) { add([front[0],front[i+1],front[i]]);add([back[0],back[i],back[i+1]]); }
		for(let i=0;i<profile.length;i++) {const j=(i+1)%profile.length;add([front[i],front[j],back[j],back[i]]);}
	}
	return { spec, width:spec.nx*spec.bay, depth:spec.nz*spec.bay, height:71.5, facades:[], pieces, hull:pieces,
		volumes:[{x0:-1.6,x1:1.6,z0:-1.6,z1:1.6,height:48}] };
}
