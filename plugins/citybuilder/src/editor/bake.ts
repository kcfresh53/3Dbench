import { treeAssets, treeKey } from './tree_assets';
import { bakedMesh } from '../core/buildings/mesh';
import type { Prefab } from '../core/buildings/prefabs';
import type { PlacedBuilding } from '../core/city/compose';
import { packBuildings } from '../core/gameready/atlas';
import type { BuildingInput, PackedBuilding } from '../core/gameready/atlas';
import { buildPatch, patchRanges } from '../core/terrain/mesh';
import { paintTerrain } from '../core/terrain/paint';
import type { MeshPart, PartFace, Vec3 } from '../core/types';
import { abortCreate, addMesh, beginCreate, finishCreate, newGroup, newTexture } from './mesh_builder';
import type { Created } from './mesh_builder';
import { rasterToDataUrl } from './files';
import type { CityStore } from './store';

const CHUNK_METRES: number = 128;
const TERRAIN_PATCH_CELLS: number = 32;

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
		target.positions.push([(p[0] * cos + p[2] * sin + b.x) * scale, (p[1] + b.y) * scale, (-p[0] * sin + p[2] * cos + b.z) * scale]);
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
	const nature = await treeAssets(plan.trees);
	const created: Created = beginCreate();
	try {
		const root = newGroup('City', 'root', created);
		const terrainGroup = newGroup('Terrain', root, created);
		const size: number = state.settings.terrainTexture;
		const albedo = paintTerrain({
			hf: plan.terrain.heights,
			surfaces: plan.surfaces,
			roadWeight: plan.terrain.roadWeight,
			lotWeight: plan.terrain.lotWeight,
			padColor: [150, 148, 140],
			waterLevel: state.settings.waterLevel,
			sun: state.settings.sun,
			size,
			seed: state.settings.seed,
		});
		const terrainTexture = newTexture('city_terrain.png', rasterToDataUrl(albedo), size, created);
		let triangles: number = 0;
		for (const range of patchRanges(plan.terrain.heights, TERRAIN_PATCH_CELLS)) {
			const patch = buildPatch(plan.terrain.heights, range.c0, range.r0, range.c1, range.r1);
			const positions: Vec3[] = [];
			for (let i: number = 0; i < patch.positions.length; i += 3) positions.push([patch.positions[i] * scale, patch.positions[i + 1] * scale, patch.positions[i + 2] * scale]);
			const faces: PartFace[] = [];
			for (let t: number = 0; t < patch.indices.length; t += 3) {
				const ids: number[] = [patch.indices[t], patch.indices[t + 1], patch.indices[t + 2]];
				faces.push({ indices: ids, uvs: ids.map((i: number): [number, number] => [patch.uvs[i * 2], patch.uvs[i * 2 + 1]]) });
			}
			addMesh(`terrain_${range.c0}_${range.r0}`, positions, faces, terrainTexture, terrainGroup, 'smooth', created.meshes);
			triangles += faces.length;
		}

		const prefabs: Prefab[] = plan.prefabs.all();
		if (plan.buildings.length > 0) {
			const g = state.settings.gameReady;
			const inputs: BuildingInput[] = prefabs.map((p: Prefab, i: number): BuildingInput => ({ name: `b${i}`, runs: p.model.facades, lods: [bakedMesh(p.model, 0)] }));
			const atlas = packBuildings(inputs, g.atlasSize, g.gutter, g.texelsPerMeter);
			const atlasTexture = newTexture('city_buildings.png', rasterToDataUrl(atlas.raster), atlas.size, created);
			const buildingGroup = newGroup('Buildings', root, created);
			const index: Map<string, PackedBuilding> = new Map<string, PackedBuilding>(prefabs.map((p: Prefab, i: number): [string, PackedBuilding] => [p.key, atlas.buildings[i]]));
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
				addMesh(`buildings_${key}`, acc.positions, acc.faces, atlasTexture, buildingGroup, 'flat', created.meshes);
				triangles += acc.faces.reduce((n: number, f: PartFace): number => n + f.indices.length - 2, 0);
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
