import { treeAssets, treeKey } from './tree_assets';
import { modularMesh } from '../core/buildings/mesh';
import type { Prefab } from '../core/buildings/prefabs';
import type { PlacedBuilding } from '../core/city/compose';
import { packBuildingPages } from '../core/gameready/atlas';
import type { BuildingInput, PackedBuilding } from '../core/gameready/atlas';
import { terrainBakePieces } from '../core/terrain/bake';
import type { MeshPart, PartFace, Vec3 } from '../core/types';
import { abortCreate, addMesh, beginCreate, finishCreate, newGroup, newMaterialGroup, newTexture } from './mesh_builder';
import type { Created } from './mesh_builder';
import { Raster } from '../core/raster';
import { foundationMesh } from '../core/buildings/foundations';
import { materialPlate } from '../texture/ambientcg';
import { rasterToDataUrl } from './files';
import type { CityStore } from './store';

const CHUNK_METRES: number = 128;

/** One channel of a packed page as its own greyscale image: Blockbench keeps every PBR channel in a texture of its own. */
function greyscale(source: Raster, channel: 0 | 1 | 2): Raster {
	const out: Raster = new Raster(source.width, source.height);
	for (let i: number = 0; i < source.data.length; i += 4) {
		const v: number = source.data[i + channel];
		out.data[i] = v;
		out.data[i + 1] = v;
		out.data[i + 2] = v;
		out.data[i + 3] = 255;
	}
	return out;
}

export interface BakeResult {
	meshes: number;
	triangles: number;
	buildings: number;
}

interface Accumulator {
	positions: Vec3[];
	faces: PartFace[];
}

function transformInto(target: Accumulator, part: MeshPart, b: PlacedBuilding, scale: number): void {
	const base: number = target.positions.length;
	const cos: number = Math.cos(b.yaw);
	const sin: number = Math.sin(b.yaw);
	for (const p of part.positions) {
		// Rotation about +Y (Three.js convention), then translate.
		target.positions.push([(p[0] * (b.scale?.[0] ?? 1) * cos + p[2] * (b.scale?.[2] ?? 1) * sin + b.x) * scale, (p[1] + b.y) * scale, (-p[0] * (b.scale?.[0] ?? 1) * sin + p[2] * (b.scale?.[2] ?? 1) * cos + b.z) * scale]);
	}
	for (const f of part.faces) target.faces.push({ indices: f.indices.map((i: number): number => base + i), uvs: f.uvs });
}

/**
 * Turns the live city into ordinary meshes: terrain patches with a baked albedo, and buildings merged
 * per 128 m block on one packed atlas. One undo step.
 */
export async function bakeCity(store: CityStore): Promise<BakeResult> {
	const state = store.state;
	const plan = store.plan;
	if (!state || !plan) throw new Error('Create a city first.');
	const scale: number = state.settings.unitsPerMeter;
	const owner=Project, revision=store.editRevision;
	const nature = await treeAssets(plan.trees);
	if(Project!==owner || store.state!==state || store.editRevision!==revision)throw new Error('The city changed while preparing the bake. Try again.');
	const created: Created = beginCreate();
	try {
		const root = newGroup('City', 'root', created);
		const terrainGroup = newGroup('Terrain', root, created);
		const size: number = state.settings.terrainTexture;
		let triangles: number = 0;
		const terrainTextures = new Map<string, Texture>();
		for (const piece of terrainBakePieces(plan,state.settings)) {
			let terrainTexture=terrainTextures.get(piece.texture);
			if (!terrainTexture) {
				const material=newMaterialGroup(`city_terrain_${piece.texture}`,created);
				terrainTexture=newTexture(`city_terrain_${piece.texture}.png`,rasterToDataUrl(piece.raster),size,created,'color',material);
				if(piece.normal)newTexture(`city_terrain_${piece.texture}_normal.png`,rasterToDataUrl(piece.normal),size,created,'normal',material);
				if(piece.orm) {
					newTexture(`city_terrain_${piece.texture}_roughness.png`,rasterToDataUrl(greyscale(piece.orm,1)),size,created,'roughness',material);
					newTexture(`city_terrain_${piece.texture}_occlusion.png`,rasterToDataUrl(greyscale(piece.orm,0)),size,created,'occlusion',material);
				}
				terrainTextures.set(piece.texture,terrainTexture);
			}
			const patch=piece.patch;
			const positions: Vec3[] = [];
			for (let i: number = 0; i < patch.positions.length; i += 3) positions.push([patch.positions[i] * scale, patch.positions[i + 1] * scale, patch.positions[i + 2] * scale]);
			const faces: PartFace[] = [];
			for (let t: number = 0; t < patch.indices.length; t += 3) {
				const ids: number[] = [patch.indices[t], patch.indices[t + 1], patch.indices[t + 2]];
				faces.push({ indices: ids, uvs: ids.map((i: number): [number, number] => [patch.uvs[i * 2], patch.uvs[i * 2 + 1]]) });
			}
			addMesh(`terrain_${piece.name}`, positions, faces, terrainTexture, terrainGroup, 'smooth', created.meshes);
			triangles += faces.length;
		}

		const prefabs: Prefab[] = plan.prefabs.all();
		const foundation=foundationMesh(plan.buildings,plan.terrain.heights);
		if(foundation.faces.length) {
			const p=materialPlate('plaster','albedo'), raster=new Raster(p.w,p.h);
			for(let i=0;i<p.w*p.h;i++)raster.set(i%p.w,Math.floor(i/p.w),[p.data[i*3],p.data[i*3+1],p.data[i*3+2]]);
			const texture=newTexture('city_foundations.png',rasterToDataUrl(raster),p.w,created);
			(texture as unknown as {wrap_mode:string;updateMaterial():void}).wrap_mode='repeat';
			(texture as unknown as {updateMaterial():void}).updateMaterial();
			addMesh('foundations',foundation.positions.map((p):Vec3=>[p[0]*scale,p[1]*scale,p[2]*scale]),foundation.faces,texture,root,'flat',created.meshes);
			triangles+=foundation.faces.length*2;
		}
		if (plan.buildings.length > 0) {
			const g = state.settings.gameReady;
			const inputs: BuildingInput[] = prefabs.map((p: Prefab, i: number): BuildingInput => ({ name: `b${i}`, runs: [], lods: [modularMesh(p.model, 0)] }));
			const pages = packBuildingPages(inputs, g.atlasSize, g.gutter, g.texelsPerMeter,g.preserveTextureDetail);
			for (const [page,atlas] of pages.entries()) {
			// The same maps the viewport shows: albedo, normal, and roughness, metalness and occlusion from the packed page.
			const material = newMaterialGroup(`city_buildings_${page}`, created);
			const atlasTexture = newTexture(`city_buildings_${page}.png`, rasterToDataUrl(atlas.raster), atlas.size, created, 'color', material);
			newTexture(`city_buildings_${page}_normal.png`, rasterToDataUrl(atlas.normal), atlas.size, created, 'normal', material);
			newTexture(`city_buildings_${page}_roughness.png`, rasterToDataUrl(greyscale(atlas.orm, 1)), atlas.size, created, 'roughness', material);
			newTexture(`city_buildings_${page}_metalness.png`, rasterToDataUrl(greyscale(atlas.orm, 2)), atlas.size, created, 'metalness', material);
			newTexture(`city_buildings_${page}_ao.png`, rasterToDataUrl(greyscale(atlas.orm, 0)), atlas.size, created, 'ao', material);
			const buildingGroup = newGroup('Buildings', root, created);
			const index: Map<string, PackedBuilding> = new Map<string, PackedBuilding>(prefabs.map((p: Prefab, i: number): [string, PackedBuilding] => [p.key, atlas.buildings.find(b=>b.name===`b${i}`)!]));
			const chunks: Map<string, Accumulator> = new Map<string, Accumulator>();
			for (const b of plan.buildings) {
				const packed: PackedBuilding | undefined = index.get(b.prefab);
				if (!packed) continue;
				const key: string = `${Math.floor(b.x / CHUNK_METRES)}_${Math.floor(b.z / CHUNK_METRES)}`;
				const acc: Accumulator = chunks.get(key) ?? { positions: [], faces: [] };
				transformInto(acc, packed.lods[0], b, scale);
				chunks.set(key, acc);
			}
			for (const [key, acc] of chunks) {
				addMesh(`buildings_${page}_${key}`, acc.positions, acc.faces, atlasTexture, buildingGroup, 'flat', created.meshes);
				triangles += acc.faces.reduce((n: number, f: PartFace): number => n + f.indices.length - 2, 0);
			}
		}
		}
		if (plan.trees.length) {
			const treeGroup = newGroup('Trees', root, created);
			for (const [key, asset] of nature) {
				const texture = newTexture(`${key}.png`, asset.dataUrl, asset.size, created);
				const chunks = new Map<string, Accumulator>();
				for (const t of plan.trees) {
					if (treeKey(t) !== key) continue;
					const chunk = `${Math.floor(t.x / CHUNK_METRES)}_${Math.floor(t.z / CHUNK_METRES)}`;
					const acc = chunks.get(chunk) ?? {positions: [], faces: []};
					const base = acc.positions.length, cos = Math.cos(t.yaw), sin = Math.sin(t.yaw);
					for (const p of asset.part.positions) acc.positions.push([
						(t.x + (p[0]*cos+p[2]*sin)*t.scale)*scale, (t.y+p[1]*t.scale)*scale, (t.z+(-p[0]*sin+p[2]*cos)*t.scale)*scale]);
					for (const f of asset.part.faces) acc.faces.push({indices:f.indices.map(i=>base+i),uvs:f.uvs});
					chunks.set(chunk,acc);
				}
				for (const [chunk,acc] of chunks) {
					addMesh(`trees_${key}_${chunk}`,acc.positions,acc.faces,texture,treeGroup,'smooth',created.meshes);
					triangles += acc.faces.reduce((n,f)=>n+f.indices.length-2,0);
				}
			}
		}
		finishCreate('Bake city to meshes', created);
		return { meshes: created.meshes.length, triangles, buildings: plan.buildings.length };
	} catch (error) {
		abortCreate(created);
		throw error;
	}
}
