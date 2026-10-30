import { pbrRoadParts } from '../core/pbr_materials';
import { materialSource } from '../../../citybuilder/src/texture/material_resources';
import type { MaterialId } from '../../../citybuilder/src/texture/material_resources';
import type { MeshPart, Vec2, Vec3 } from '../core/types';
import type { GenerateResult } from '../core/generate';
import type { RoadLibrary } from '../core/library_types';
import { ROAD_ATLAS } from '../core/library_types';
import { BAKED_KEY } from './ids';
import type { TreeAtlas } from './tree_provider';

interface UndoAspects {
	elements: Mesh[];
	textures: Texture[];
	groups: Group[];
}

function undoAspects(): UndoAspects {
	return (Undo as unknown as { current_save: { aspects: UndoAspects } }).current_save.aspects;
}

interface PreparedTexture { name:string; dataUrl:string; channel:string }
async function preparePbr(atlas:string):Promise<PreparedTexture[]> {
 const id=atlas.slice(4).replace('_wet','') as MaterialId;
 const fs=require('node:fs') as {readFileSync(path:string,encoding:'base64'):string};
 const url=(channel:'albedo'|'normal'|'orm'):string=>'data:image/jpeg;base64,'+fs.readFileSync(materialSource(id,channel),'base64');
 const result=[{name:`roadscape_${id}_albedo.jpg`,dataUrl:url('albedo'),channel:'color'},
  {name:`roadscape_${id}_normal.jpg`,dataUrl:url('normal'),channel:'normal'}];
 const image=new Image();image.src=url('orm');await image.decode();
 const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
 const context=canvas.getContext('2d') as CanvasRenderingContext2D;context.drawImage(image,0,0);
 const source=context.getImageData(0,0,image.width,image.height),output=context.createImageData(image.width,image.height);
 for(const [channel,index] of [['occlusion',0],['roughness',1],['metalness',2]] as const) {
  for(let i=0;i<source.data.length;i+=4) {
   const value=source.data[i+index]*(channel==='roughness'&&atlas.endsWith('_wet')?.3:1);
   output.data[i]=output.data[i+1]=output.data[i+2]=value;output.data[i+3]=255;
  }
  context.putImageData(output,0,0);result.push({name:`roadscape_${id}_${channel}.png`,dataUrl:canvas.toDataURL('image/png'),channel});
 }
 return result;
}
function makeTexture(atlas: string, library: RoadLibrary, lookup: (key: string) => TreeAtlas | undefined, created:Texture[], materialGroups:TextureGroup[],prepared:Map<string,PreparedTexture[]>): {texture:Texture;size:number} {
 if(atlas.startsWith('pbr:')) {
  const id=atlas.slice(4),group=new TextureGroup({is_material:true} as never);group.name=`roadscape_${id}`;group.add();materialGroups.push(group);
  let color:Texture|null=null;
  for(const data of prepared.get(atlas)??[]) {
   const texture=new Texture({sampling:'smooth',wrap_mode:'repeat',name:data.name,uv_width:4096,uv_height:4096,pbr_channel:data.channel} as never).fromDataURL(data.dataUrl).add(false) as Texture;
   texture.group=group.uuid;created.push(texture);if(data.channel==='color')color=texture;
  }
  if(!color)throw new Error('Road PBR material was not prepared.');
  return {texture:color,size:4096};
 }

	if (atlas === ROAD_ATLAS) {
		const texture: Texture = new Texture({ sampling: 'smooth', name: 'roadscape_atlas.png', uv_width: library.atlasSize, uv_height: library.atlasSize } as never).fromDataURL(library.atlas).add(false) as Texture;
		return { texture, size: library.atlasSize };
	}
	const tree: TreeAtlas | undefined = lookup(atlas);
	if (!tree) throw new Error('A tree atlas is missing; wait for trees to finish building.');
	const texture: Texture = new Texture({ sampling: 'smooth', name: 'roadscape_trees.png', uv_width: tree.size, uv_height: tree.size } as never).fromDataURL(tree.dataUrl).add(false) as Texture;
	return { texture, size: tree.size };
}

function addPart(part: MeshPart, group: Group, source: Mesh, texture: Texture, size: number, created: Mesh[]): void {
	const mesh: Mesh = new Mesh({
		name: part.name,
		origin: [...source.origin],
		rotation: [...source.rotation],
		scale: [...((source as unknown as { scale?: ArrayVector3 }).scale ?? [1, 1, 1])],
		vertices: {},
		shading: 'flat',
	} as never)
		.addTo(group) as Mesh;
	created.push(mesh);
	mesh.init();
	const keys: string[] = part.positions.map((p: Vec3): string => mesh.addVertices(p)[0]);
	// Large buffers go through in slices so no single argument list becomes huge.
	for (let start: number = 0; start < part.faces.length; start += 2000) {
		mesh.addFaces(
			...part.faces.slice(start, start + 2000).map((face): MeshFace => {
				const vertices: string[] = face.indices.map((i: number): string => keys[i]);
				const uv: Record<string, Vec2> = {};
				vertices.forEach((key: string, i: number): void => {
					uv[key] = [face.uvs[i][0] * size, face.uvs[i][1] * size];
				});
				return new MeshFace(mesh, { vertices, uv, texture: texture.uuid } as never);
			}),
		);
	}
}

/**
 * Replaces a live road network with ordinary meshes: one mesh per part, one texture per atlas.
 * One undo step; undoing restores the editable network.
 */
export async function bakeRoad(result: GenerateResult, library: RoadLibrary, lookup: (key: string) => TreeAtlas | undefined, source: Mesh): Promise<Group> {
 const owner=Project,signature=JSON.stringify([source.vertices,source.rotation,source.origin,(source as unknown as Record<string,string>).roadscape_net]);
 const parts=pbrRoadParts(result.parts,library),prepared=new Map<string,PreparedTexture[]>();
 // Decode and split the large maps before opening an undo transaction or changing the project.
 for(const atlas of new Set(parts.map(p=>p.atlas)))if(atlas.startsWith('pbr:'))prepared.set(atlas,await preparePbr(atlas));
 if(owner!==Project||!Mesh.all.includes(source)||signature!==JSON.stringify([source.vertices,source.rotation,source.origin,(source as unknown as Record<string,string>).roadscape_net]))throw new Error('The road changed while preparing materials. Try again.');

	Undo.initEdit({ outliner: true, elements: [source], groups: [], textures: [], texture_groups: [], selection: true } as never);
	const elements: Mesh[] = [];
	const groups: Group[] = [];
	const textures: Texture[] = [];
	const materialGroups: TextureGroup[] = [];
	try {
		const group: Group = new Group({ name: 'Roadscape road' }).addTo(source.parent ?? Outliner.ROOT).init() as Group;
		group.createUniqueName();
		groups.push(group);
		const tracked: Group[] = undoAspects().groups;
		if (!tracked.includes(group)) tracked.push(group);
		(group as unknown as Record<string, string>)[BAKED_KEY] = '';
		const made: Map<string, { texture: Texture; size: number }> = new Map();
		for (const part of parts) {
			let entry: { texture: Texture; size: number } | undefined = made.get(part.atlas);
			if (!entry) {
				entry = makeTexture(part.atlas, library, lookup, textures, materialGroups,prepared);
				made.set(part.atlas, entry);
				if(!textures.includes(entry.texture))textures.push(entry.texture);
			}
			addPart(part, group, source, entry.texture, entry.size, elements);
		}
		source.remove();
		unselectAllElements();
		group.select();
		Undo.finishEdit('Bake Roadscape to Meshes', { outliner: true, groups, elements, textures, texture_groups: materialGroups, selection: true } as never);
		Canvas.updateAll();
		return group;
	} catch (error) {
		const aspects: UndoAspects = undoAspects();
		aspects.elements.push(...elements);
		aspects.textures.push(...textures);
		aspects.elements = aspects.elements.filter((e: Mesh): boolean => Outliner.elements.includes(e));
		aspects.textures = aspects.textures.filter((t: Texture): boolean => Texture.all.includes(t));
		aspects.groups = aspects.groups.filter((g: Group): boolean => Group.all.includes(g));
		Undo.cancelEdit(true);
		for(const group of materialGroups)group.remove();
		throw error;
	}
}
