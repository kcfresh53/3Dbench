import type { Raster } from '../raster';
import { bakedMesh, meshTriangles, modularMesh, silhouetteMesh } from '../buildings/mesh';
import type { Prefab } from '../buildings/prefabs';
import type { CityPlan } from '../city/compose';
import { buildManifest, heightmapBytes } from '../city/manifest';
import type { CityManifest } from '../city/manifest';
import type { CityState } from '../city/state';
import { terrainBakePieces } from '../terrain/bake';
import type { PropMesh } from '../types';
import { packBuildingPages } from './atlas';
import type { AtlasResult, BuildingInput } from './atlas';
import { GODOT_LOADER } from './godot_loader';
import { partToObj, patchToObj } from './obj';

export interface PackageFile {
	path: string;
	text?: string;
	bytes?: Uint8Array;
	/** Raster to be encoded as PNG by the host. */
	raster?: Raster;
}

export interface PackageReport {
	prefabs: number;
	buildings: number;
	trees: number;
	atlasPages: number;
	atlasSize: number;
	texelsPerMeter: number;
	/** Triangles of one instance, summed over all prefabs, per level of detail. */
	prefabTriangles: number[];
	/** Triangles on screen if every building used its finest mesh. */
	cityTriangles: number;
	terrainTriangles: number;
	warnings: string[];
}

export interface GamePackage {
	files: PackageFile[];
	report: PackageReport;
	manifest: CityManifest;
}


function lodMeshes(prefab: Prefab, state: CityState): PropMesh[] {
	const g = state.settings.gameReady;
	const build = g.bakeFacades ? bakedMesh : modularMesh;
	const list: PropMesh[] = [build(prefab.model, 0)];
	if (g.lods) list.push(build(prefab.model, 1), silhouetteMesh(prefab.model));
	return list;
}

/**
 * Builds everything a game needs: building meshes in three levels of detail on one packed atlas,
 * terrain chunks with a baked albedo, collision boxes, a heightmap, a manifest and a Godot loader.
 */
export function buildGamePackage(plan: CityPlan, state: CityState): GamePackage {
	const g = state.settings.gameReady;
	const warnings: string[] = [];
	const prefabs: Prefab[] = plan.prefabs.all();
	const inputs: BuildingInput[] = prefabs.map((p: Prefab, i: number): BuildingInput => ({ name: `building_${i}`, runs: g.bakeFacades ? p.model.facades : [], lods: lodMeshes(p, state) }));
	const pages: AtlasResult[] = packBuildingPages(inputs,g.atlasSize,g.gutter,g.texelsPerMeter,g.preserveTextureDetail);
	const atlas=pages[0];
	const buildingAtlases=new Map<string,string>();
	if (atlas && atlas.texelsPerMeter < g.texelsPerMeter) warnings.push(`Facade resolution was lowered from ${g.texelsPerMeter} to ${atlas.texelsPerMeter} texels per metre to fit a ${g.atlasSize}px atlas.`);

	const files: PackageFile[] = [];
	const names: Map<string, string[]> = new Map<string, string[]>();
	const prefabTriangles: number[] = [0, 0, 0];
	for (const [page,atlas] of pages.entries()) {
		const atlasPath=page===0?'buildings/atlas.png':`buildings/atlas_${page}.png`;
		files.push({path:atlasPath,raster:atlas.raster});
		atlas.buildings.forEach((b): void => {
			const i=Number(b.name.replace('building_',''));
			buildingAtlases.set(prefabs[i].key,atlasPath);
			const list: string[] = [];
			b.lods.forEach((part, lod: number): void => {
				files.push({ path: `buildings/${part.name}.obj`, text: partToObj(part, part.name) });
				list.push(part.name);
				prefabTriangles[lod] += meshTriangles({ positions: part.positions, faces: part.faces.map((face) => ({ ...face, material: '' })) });
			});
			names.set(prefabs[i].key, list);
		});
	}

	const chunks: string[] = [], chunkAlbedos: string[] = [];
	const textures=new Set<string>();
	let terrainTriangles=0;
	for(const piece of terrainBakePieces(plan,state.settings)) {
		const path=`terrain/${piece.name}.obj`, albedo=`terrain/${piece.texture}.png`;
		files.push({path,text:patchToObj(piece.patch,piece.name)});
		if(!textures.has(albedo)) {files.push({path:albedo,raster:piece.raster});textures.add(albedo);}
		chunks.push(path);chunkAlbedos.push(albedo);terrainTriangles+=piece.patch.indices.length/3;
	}
	files.push({ path: 'terrain/heightmap.bin', bytes: heightmapBytes(plan) });

	const manifest: CityManifest = buildManifest(plan, state.settings, names, { heightmap: 'terrain/heightmap.bin', albedo: chunkAlbedos[0], chunks, chunkAlbedos });
	for(const p of manifest.prefabs)p.atlas=buildingAtlases.get(p.id);
	files.push({ path: 'city.json', text: JSON.stringify(manifest, null, 1) });
	files.push({ path: 'city_loader.gd', text: GODOT_LOADER });

	let cityTriangles: number = terrainTriangles;
	const uses: Map<string, number> = new Map<string, number>(prefabs.map((p: Prefab): [string, number] => [p.key, 0]));
	for (const b of plan.buildings) uses.set(b.prefab, (uses.get(b.prefab) ?? 0) + 1);
	pages.flatMap(a=>a.buildings).forEach((b): void => {
		const i=Number(b.name.replace('building_',''));
		cityTriangles += (uses.get(prefabs[i].key) ?? 0) * meshTriangles({ positions: b.lods[0].positions, faces: b.lods[0].faces.map((face) => ({ ...face, material: '' })) });
	});
	return {
		files,
		manifest,
		report: {
			prefabs: prefabs.length,
			buildings: plan.buildings.length,
			trees: plan.trees.length,
			atlasPages: pages.length,
			atlasSize: atlas?.size ?? 0,
			texelsPerMeter: atlas?.texelsPerMeter ?? 0,
			prefabTriangles,
			cityTriangles,
			terrainTriangles,
			warnings,
		},
	};
}
