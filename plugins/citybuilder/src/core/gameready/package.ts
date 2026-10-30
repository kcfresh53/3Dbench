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
import { partToGlb, patchToGlb } from './gltf';
import { foundationMesh } from '../buildings/foundations';
import { materialSource, materialInfo, MATERIAL_IDS } from '../../texture/ambientcg';
import { terrainLayers } from '../terrain/layers';
import { STOCHASTIC_GLSL } from '../../texture/stochastic';

export interface PackageFile {
	path: string;
	text?: string;
	bytes?: Uint8Array;
	/** Bundled offline resource copied without resampling. */
	source?: string;
	/** Raster to be encoded as PNG by the host. */
	raster?: Raster;
	/** Preserve independent RGBA channels without canvas alpha premultiplication. */
	dataTexture?: boolean;
}

export interface PackageReport {
	prefabs: number;
	buildings: number;
	trees: number;
	roads: number;
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
 * terrain chunks with a baked albedo, collision boxes, a heightmap, and a manifest.
 */
export function buildGamePackage(plan: CityPlan, state: CityState): GamePackage {
	const g = state.settings.gameReady;
	const warnings: string[] = [];
	const include = state.settings.export;
	// Water is never exported; the manifest only records its level. What else leaves is chosen in the export settings.
	const prefabs: Prefab[] = include.buildings ? plan.prefabs.all() : [];
	const inputs: BuildingInput[] = prefabs.map((p: Prefab, i: number): BuildingInput => ({ name: `building_${i}`, runs: g.bakeFacades ? p.model.facades : [], lods: lodMeshes(p, state) }));
	const pages: AtlasResult[] = packBuildingPages(inputs,g.atlasSize,g.gutter,g.texelsPerMeter,g.preserveTextureDetail);
	const atlas=pages[0];
	const buildingAtlases=new Map<string,string>();
	const pbrPages=new Map<string,[string,string]>();
	if (atlas && atlas.texelsPerMeter < g.texelsPerMeter) warnings.push(`Facade resolution was lowered from ${g.texelsPerMeter} to ${atlas.texelsPerMeter} texels per metre to fit a ${g.atlasSize}px atlas.`);

	const files: PackageFile[] = [];
	const names: Map<string, string[]> = new Map<string, string[]>();
	const prefabTriangles: number[] = [0, 0, 0];
	for (const [page,atlas] of pages.entries()) {
		const atlasPath=page===0?'buildings/atlas.png':`buildings/atlas_${page}.png`;
		files.push({path:atlasPath,raster:atlas.raster});
		const ormPath=atlasPath.replace('.png','_orm.png'), normalPath=atlasPath.replace('.png','_n.png');
		if(g.pbr) {
			files.push({path:ormPath,raster:atlas.orm},{path:normalPath,raster:atlas.normal});
			pbrPages.set(atlasPath,[ormPath,normalPath]);
		}
		atlas.buildings.forEach((b): void => {
			const i=Number(b.name.replace('building_',''));
			buildingAtlases.set(prefabs[i].key,atlasPath);
			const list: string[] = [];
			b.lods.forEach((part, lod: number): void => {
				files.push({ path: `buildings/${part.name}.glb`, bytes: partToGlb(part, part.name, { baseColor: atlasPath.split('/').pop() as string, orm: g.pbr ? ormPath.split('/').pop() : undefined, normal: g.pbr ? normalPath.split('/').pop() : undefined }) });
				list.push(part.name);
				prefabTriangles[lod] += meshTriangles({ positions: part.positions, faces: part.faces.map((face) => ({ ...face, material: '' })) });
			});
			names.set(prefabs[i].key, list);
		});
	}

	const chunks: string[] = [], chunkAlbedos: string[] = [], chunkNormals: string[] = [], chunkOrms: string[] = [];
	const textures=new Set<string>();
	let foundationTriangles=0;
	let terrainTriangles=0;
	for(const piece of include.terrain ? terrainBakePieces(plan,state.settings) : []) {
		const path=`terrain/${piece.name}.glb`, albedo=`terrain/${piece.texture}.png`;
		files.push({path,bytes:patchToGlb(piece.patch,piece.name,{baseColor:`${piece.texture}.png`,orm:piece.orm?`${piece.texture}_orm.png`:undefined,normal:piece.normal?`${piece.texture}_n.png`:undefined})});
		if(!textures.has(albedo)) {
			files.push({path:albedo,raster:piece.raster});textures.add(albedo);
			if(piece.orm) files.push({path:`terrain/${piece.texture}_orm.png`,raster:piece.orm});
			if(piece.normal) files.push({path:`terrain/${piece.texture}_n.png`,raster:piece.normal});
		}
		if(piece.orm) chunkOrms.push(`terrain/${piece.texture}_orm.png`);
		if(piece.normal) chunkNormals.push(`terrain/${piece.texture}_n.png`);
		chunks.push(path);chunkAlbedos.push(albedo);terrainTriangles+=piece.patch.indices.length/3;
	}
	if (include.terrain) files.push({ path: 'terrain/heightmap.bin', bytes: heightmapBytes(plan) });

	const manifest: CityManifest = buildManifest(plan, state.settings, names, { heightmap: include.terrain ? 'terrain/heightmap.bin' : '', albedo: chunkAlbedos[0] ?? '', chunks, chunkAlbedos });
	manifest.terrain.chunkNormals = chunkNormals;
	manifest.terrain.chunkOrms = chunkOrms;
	// Sources preserve near-camera detail regardless of the size of the city or baked chunks.
	if (include.terrain || include.buildings || include.roads) {
		manifest.materials = MATERIAL_IDS.map(id => {
			const info = materialInfo(id);
			for(const channel of g.pbr ? ['albedo','normal','orm'] as const : ['albedo'] as const)
				files.push({path:`materials/${id}_${channel}.jpg`,source:materialSource(id,channel)});
			return {id,source:info.source,license:info.license,width:info.width,height:info.height,metres:info.metres,albedoMeanLinear:info.albedoMeanLinear,
				albedo:`materials/${id}_albedo.jpg`,...(g.pbr?{normal:`materials/${id}_normal.jpg`,orm:`materials/${id}_orm.jpg`}:{})};
		});
	}
	if(include.terrain) {
		const layers = terrainLayers(plan, state.settings);
		manifest.terrain.layers = layers.manifest;
		files.push(...layers.files);
		files.push({path:'materials/stochastic.glsl',text:STOCHASTIC_GLSL});
	}
	if(include.buildings && plan.buildings.length) {
		const foundation = foundationMesh(plan.buildings, plan.terrain.heights);
		if (foundation.faces.length) {
			foundationTriangles=foundation.faces.reduce((n,f)=>n+f.indices.length-2,0);
			manifest.foundations = 'buildings/foundations.glb';
			files.push({path:manifest.foundations,bytes:partToGlb(foundation,'foundations',{baseColor:'../materials/plaster_albedo.jpg',
				normal:g.pbr?'../materials/plaster_normal.jpg':undefined,orm:g.pbr?'../materials/plaster_orm.jpg':undefined,repeat:true})});
		}
	}
	for(const p of manifest.prefabs) {
		p.atlas=buildingAtlases.get(p.id);
		const pbr=p.atlas?pbrPages.get(p.atlas):undefined;
		if(pbr) {p.atlasOrm=pbr[0];p.atlasNormal=pbr[1];}
	}
	files.push({ path: 'city.json', text: JSON.stringify(manifest, null, 1) });
	files.push({path:'materials/README.md',text:GAME_MATERIAL_GUIDE});

	let cityTriangles: number = terrainTriangles+foundationTriangles;
	const uses: Map<string, number> = new Map<string, number>(prefabs.map((p: Prefab): [string, number] => [p.key, 0]));
	for (const b of include.buildings ? plan.buildings : []) uses.set(b.prefab, (uses.get(b.prefab) ?? 0) + 1);
	pages.flatMap(a=>a.buildings).forEach((b): void => {
		const i=Number(b.name.replace('building_',''));
		cityTriangles += (uses.get(prefabs[i].key) ?? 0) * meshTriangles({ positions: b.lods[0].positions, faces: b.lods[0].faces.map((face) => ({ ...face, material: '' })) });
	});
	return {
		files,
		manifest,
		report: {
			prefabs: prefabs.length,
			buildings: include.buildings ? plan.buildings.length : 0,
			trees: include.trees ? plan.trees.length : 0,
			roads: manifest.roads?.length ?? 0,
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

const GAME_MATERIAL_GUIDE = `# City Builder materials

Albedo is sRGB. Tangent-space normals (OpenGL, +Y) and packed ORM are linear data.
ORM channels: R = ambient occlusion, G = roughness, B = metallic. Do not invert roughness.
All original material sheets retain their 4K resolution (brick is 4096 x 2048).

Standard glTF terrain chunks use padded PBR overview bakes. For close camera work on a
large map, use the original materials and terrain.layers in city.json in your engine's terrain shader:

1. Mask UV = (worldXZ - layers.origin) / layers.size. Clamp and linearly filter masks.
2. Each entry selects one RGBA channel of masks[entry.mask]. Import masks as linear RGBA
   data, with no alpha transparency processing, premultiplication, colour conversion or lossy compression.
3. Normalize the sampled weights so they sum to one. Each entry refers to a material ID.
4. Tile UV = worldXZ / material.metres. terrain.layers.stochastic records the seed and
   algorithm for stochastic tiling. Port materials/stochastic.glsl into your terrain shader:
   supply cityStochasticSeed, cityStochasticAlbedoMean = material.albedoMeanLinear,
   and mapTexelToLinear (sRGB-to-linear for colour). Variance preservation avoids faded
   triangular patches in the blend. Use
   cityStochasticSample with kind 0 for albedo, 1 for normals, 2 for ORM. All maps must
   share the same hash, offsets and rotations; normals are inverse-rotated before blending.
   The normalized triangular blend is continuous across cell edges, without sine-based hashes.
   Repeat/trilinear-filter the source textures;
   use anisotropic filtering. Multiply albedo by the entry's tint. Blend albedo in linear space,
   ORM as data and normalize blended tangent-space normals. Mud roughness is scaled by 0.62.
5. Supply engine lighting, sky/reflection probes and shadows. No sun lighting is baked into albedo.

The separate foundations mesh is already in world metres; place it once at identity transform.
Building prefabs use their atlas PBR materials and manifest instance transforms. New projects
default to 64 px/m facades; higher densities are available under Export, with detail preservation.
Road meshes are in roads/, referenced by roadMeshes; place them once at identity transform.
The manifest also retains the editable centreline graph.
The live terrain uses filtered 1K GPU mips to limit VRAM; the exported source sheets remain 4K.
All ambientCG sheets are CC0; sources and world repeat sizes are in city.json.
`;
