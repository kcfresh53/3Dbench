import type { MeshPart } from './types';
import type { RoadLibrary } from './library_types';
import { tileSizeMeters } from './strip_library';
import { materialInfo } from '../../../citybuilder/src/texture/material_resources';
import type { MaterialId } from '../../../citybuilder/src/texture/material_resources';

const sources:Record<string,string> = {
	'Road':'asphalt', 'Road Wet':'asphalt_wet',
	// Sidewalks and curbs retain the original Roadscape atlas artwork and UVs.
	'Gutters Regular':'concrete','Bridge Deck':'plaster',
	'Tunnel Barrier':'plaster','Terrain Spring':'grass','Terrain Snow':'snow',
	'Trail Support Spring':'dirt','Trail Support Snow':'snow',
};

/** Unpacks only surface faces from the legacy atlas. Props and painted markings keep their artwork.
 * Surface UVs become local to a full-resolution tile; no 4K material is squeezed into an atlas cell.
 */
export function pbrRoadParts(parts:MeshPart[], library:RoadLibrary):MeshPart[] {
	const result:MeshPart[]=[];
	const tiles=Object.entries(sources).flatMap(([name,id])=>library.materials[name]?[{id,tile:library.materials[name].tile,
		metres:materialInfo(id.replace('_wet','') as MaterialId).metres,length:tileSizeMeters(name)}]:[]);
	for(const part of parts) {
		if(part.atlas!=='road') {result.push(part);continue;}
		const groups=new Map<string,MeshPart>();
		for(const face of part.faces) {
			const found=tiles.find(({tile:[u,v,s]})=>face.uvs.every(p=>p[0]>=u-1e-7&&p[1]>=v-1e-7&&p[0]<=u+s+1e-7&&p[1]<=v+s+1e-7));
			const atlas=found?`pbr:${found.id}`:'road';
			let output=groups.get(atlas);
			if(!output) {output={name:part.name,atlas,positions:[],faces:[]};groups.set(atlas,output);result.push(output);}
			const start=output.positions.length;
			output.positions.push(...face.indices.map(i=>part.positions[i]));
			output.faces.push({...face,indices:face.indices.map((_,i)=>start+i),uvs:face.uvs.map(p=>found?[(p[0]-found.tile[0])/found.tile[2]*found.length/found.metres[0],(p[1]-found.tile[1])/found.tile[2]*found.length/found.metres[1]]:[...p])});
		}
	}
	return result;
}
