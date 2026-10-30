import type { GamePackage } from '../core/gameready/package';
import type { CityStore } from './store';
import { partToGlb } from '../core/gameready/gltf';
import { pbrRoadParts } from '../../../roadscape/src/core/pbr_materials';
import type { RoadLibrary } from '../../../roadscape/src/core/library_types';
import type { GenerateResult } from '../../../roadscape/src/core/generate';
import { materialInfo } from '../texture/material_resources';
import type { MaterialId } from '../texture/material_resources';
import type { Vec3 } from '../core/types';

interface RoadManager {
	ready:Promise<RoadLibrary>;
	resultOf(mesh:Mesh):GenerateResult|null;
	update(mesh:Mesh,override?:undefined,force?:boolean):void;
	trees:{atlas(key:string):{dataUrl:string}|undefined};
}

/** Export road geometry directly against shared 4K resources, without expanding native PBR images in VRAM. */
export async function addRoadsToPackage(pkg:GamePackage,store:CityStore):Promise<void> {
	if(!store.state?.settings.export.roads)return;
	const meshes=store.bridge.meshes();if(!meshes.length)return;
	const panel=Panels.roadscape_panel as unknown as {vue?:{session?:{manager?:RoadManager}}}|undefined;
	const manager=panel?.vue?.session?.manager;
	if(!manager)throw new Error('Load Roadscape to include road meshes in the game package.');
	const library=await manager.ready,scale=1/store.state.settings.unitsPerMeter;
	const textures=new Map<string,string>();pkg.manifest.roadMeshes=[];
	for(const [road,mesh] of meshes.entries()) {
		manager.update(mesh,undefined,true);
		const result=manager.resultOf(mesh);if(!result)throw new Error('Roadscape could not generate a road for export.');
		mesh.mesh.updateWorldMatrix(true,false);const matrix=mesh.mesh.matrixWorld;
		for(const [index,part] of pbrRoadParts(result.parts,library).entries()) {
			if(!store.state.settings.export.trees&&part.atlas!=='road'&&!part.atlas.startsWith('pbr:'))continue;
			const name=`road_${road}_${index}`,path=`roads/${name}.glb`;
			let baseColor:string,normal:string|undefined,orm:string|undefined;
			if(part.atlas.startsWith('pbr:')) {
				const id=part.atlas.slice(4).replace('_wet','') as MaterialId;
				// Validate the material key before writing a dangling URI.
				if(!materialInfo(id))throw new Error(`Missing road material ${id}`);
				baseColor=`../materials/${id}_albedo.jpg`;
				if(store.state.settings.gameReady.pbr){normal=`../materials/${id}_normal.jpg`;orm=`../materials/${id}_orm.jpg`;}
			} else {
				let texture=textures.get(part.atlas);
				if(!texture) {
					const url=part.atlas==='road'?library.atlas:manager.trees.atlas(part.atlas)?.dataUrl;
					if(!url)throw new Error('A Roadscape foliage texture is still preparing. Try exporting again.');
					texture=`atlas_${textures.size}.png`;textures.set(part.atlas,texture);
					pkg.files.push({path:`roads/${texture}`,bytes:Uint8Array.from(atob(url.split(',')[1]),c=>c.charCodeAt(0))});
				}
				baseColor=texture;
			}
			const positions=part.positions.map((p):Vec3=>{
				const v=new THREE.Vector3(...p).applyMatrix4(matrix).multiplyScalar(scale);return [v.x,v.y,v.z];
			});
			const wet=part.atlas.endsWith('_wet');
			pkg.files.push({path,bytes:partToGlb({...part,positions},name,{baseColor,normal,orm,
				repeat:part.atlas.startsWith('pbr:'),roughness:wet?.3:1,doubleSided:true,cutout:part.atlas.startsWith('pbr:')?undefined:.5})});
			pkg.manifest.roadMeshes.push(path);pkg.report.cityTriangles+=part.faces.reduce((n,f)=>n+f.indices.length-2,0);
		}
	}
	const manifest=pkg.files.find(f=>f.path==='city.json');if(manifest)manifest.text=JSON.stringify(pkg.manifest,null,1);
}
