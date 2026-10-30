import { pbrRoadParts } from '../core/pbr_materials';
import { materialPreviewSource } from '../../../citybuilder/src/texture/material_resources';
import type { MaterialId } from '../../../citybuilder/src/texture/material_resources';
import type { MeshPart } from '../core/types';
import type { RoadLibrary } from '../core/library_types';
import { ROAD_ATLAS } from '../core/library_types';
import type { TreeAtlas } from './tree_provider';
import { LIVE_BODY_NAME } from './ids';

/** Turns generated parts into one draw call per atlas. Nothing is added to the project. */
export function geometryForParts(parts: MeshPart[]): THREE.BufferGeometry {
	const positions: number[] = [];
	const uvs: number[] = [];
	for (const part of parts) {
		for (const face of part.faces) {
			for (let i: number = 1; i < face.indices.length - 1; i++) {
				for (const j of [0, i, i + 1]) {
					const p: [number, number, number] = part.positions[face.indices[j]];
					positions.push(p[0], p[1], p[2]);
					uvs.push(face.uvs[j][0], face.uvs[j][1]);
				}
			}
		}
	}
	const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	geometry.setAttribute('uv2',geometry.getAttribute('uv'));
	geometry.computeVertexNormals();
	geometry.computeBoundingSphere();
	return geometry;
}

/** Shares one texture and material per atlas across every live road. */
export class MaterialPool {
	private readonly materials: Map<string, THREE.MeshBasicMaterial | THREE.MeshStandardMaterial> = new Map();
	private readonly textures: Map<string, THREE.Texture> = new Map();

	constructor(
		readonly library: RoadLibrary,
		private readonly lookup: (key: string) => TreeAtlas | undefined,
		private readonly onLoaded: () => void,
	) {}

	material(atlas: string): THREE.MeshBasicMaterial | THREE.MeshStandardMaterial | null {
		const existing: THREE.MeshBasicMaterial | THREE.MeshStandardMaterial | undefined = this.materials.get(atlas);
		if (existing) return existing;
  if(atlas.startsWith('pbr:')) {
   const id=atlas.slice(4).replace('_wet','') as MaterialId;
   const load=(channel:'albedo'|'normal'|'orm'):THREE.Texture=>{
    const texture=new THREE.TextureLoader().load(materialPreviewSource(id,channel),this.onLoaded);
    texture.flipY=false;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.anisotropy=16;
    if(channel==='albedo')texture.encoding=THREE.sRGBEncoding;
    this.textures.set(`${atlas}:${channel}`,texture);return texture;
   };
   const orm=load('orm');
   const material=new THREE.MeshStandardMaterial({map:load('albedo'),normalMap:load('normal'),roughnessMap:orm,metalnessMap:orm,aoMap:orm,
    roughness:atlas.endsWith('_wet')?.3:1,metalness:1,side:THREE.DoubleSide});
   this.materials.set(atlas,material);return material;
  }
		const url: string | undefined = atlas === ROAD_ATLAS ? this.library.atlas : this.lookup(atlas)?.dataUrl;
		if (!url) return null;
		const texture: THREE.Texture = new THREE.TextureLoader().load(url, (): void => this.onLoaded());
		texture.flipY = false;
		texture.magFilter = atlas === ROAD_ATLAS ? THREE.LinearFilter : THREE.NearestFilter;
		texture.encoding=THREE.sRGBEncoding;
		const material: THREE.MeshBasicMaterial = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, alphaTest: 0.5, toneMapped:false });
		this.textures.set(atlas, texture);
		this.materials.set(atlas, material);
		return material;
	}

	dispose(): void {
		for (const m of this.materials.values()) m.dispose();
		for (const t of this.textures.values()) t.dispose();
		this.materials.clear();
		this.textures.clear();
	}
}

export function makeRoadBody(parts: MeshPart[], pool: MaterialPool): THREE.Group {
	const group: THREE.Group = new THREE.Group();
	group.name = LIVE_BODY_NAME;
	(group as unknown as { no_export: boolean }).no_export = true;
	const byAtlas: Map<string, MeshPart[]> = new Map();
	for (const part of pbrRoadParts(parts,pool.library)) {
		const list: MeshPart[] = byAtlas.get(part.atlas) ?? [];
		list.push(part);
		byAtlas.set(part.atlas, list);
	}
	for (const [atlas, list] of byAtlas) {
		const material = pool.material(atlas);
		if (!material) continue;
		const object: THREE.Mesh = new THREE.Mesh(geometryForParts(list), material);
		(object as unknown as { no_export: boolean }).no_export = true;
		object.name = `${LIVE_BODY_NAME} (${atlas})`;
		object.receiveShadow=true;
		group.add(object);
	}
	return group;
}

export function disposeBody(body: THREE.Object3D | null): void {
	if (!body) return;
	body.traverse((o: THREE.Object3D): void => {
		const mesh: THREE.Mesh = o as THREE.Mesh;
		mesh.geometry?.dispose();
	});
	body.removeFromParent();
}
