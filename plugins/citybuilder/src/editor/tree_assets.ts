import { fitToBudget } from '../../../procedural_trees/src/core/tree_generator';
import { mergeMeshData } from '../../../procedural_trees/src/core/mesh_builder';
import { presetParams } from '../../../procedural_trees/src/ui/presets';
import type { PresetName } from '../../../procedural_trees/src/core/types';
import { paintAtlas } from '../../../procedural_trees/src/texture/atlas';
import { geometryForParts } from '../../../roadscape/src/editor/live_render';
import cutouts from '../texture/tree_cutouts.json';
import type { PlacedTree } from '../core/nature/scatter';
import type { MeshPart } from '../core/types';

export interface CityTreeAsset { part: MeshPart; dataUrl: string; size: number }
const cache = new Map<string, Promise<CityTreeAsset>>();
export function treeKey(t: PlacedTree): string { return `${t.preset}_${t.representation}_${t.variant}`; }
function crossPart(key: string, width: number, height: number): MeshPart {
	return { name: key, atlas: key,
		positions: [[-width/2,0,0],[width/2,0,0],[width/2,height,0],[-width/2,height,0], [0,0,-width/2],[0,0,width/2],[0,height,width/2],[0,height,-width/2]],
		faces: [[0,1,2,3],[4,5,6,7]].map(indices => ({indices,uvs:[[0,1],[1,1],[1,0],[0,0]]})) };
}
async function build(t: PlacedTree): Promise<CityTreeAsset> {
	const key = treeKey(t);
	const species = t.preset.split('_')[0];
	const height = ({oak:9,pine:12,birch:8,bush:2.5,palm:10} as Record<string,number>)[species] ?? 9;
	if (t.representation === 'cross' && species !== 'palm') {
		const id = species === 'pine' ? [1,2,4][t.variant % 3] : species === 'birch' ? 3 : 5;
		const source = (cutouts as Record<string,{aspect:number;url:string}>)[String(id)];
		return {part:crossPart(key,height*source.aspect,height),dataUrl:source.url,size:512};
	}
	const params = {...presetParams(t.preset as PresetName), height, seed: 71 + t.variant * 977,
		maxTriangles:1800,lodCount:1,textureSize:512,useBundledTextures:true,separateFoliage:false,spreadLods:false};
	const lod = fitToBudget(params,params.maxTriangles);
	const mesh = mergeMeshData(lod.trunk,lod.foliage);
	const part: MeshPart = {name:key,atlas:key,positions:mesh.positions,faces:mesh.faces};
	const dataUrl = await paintAtlas(params);
	if (t.representation !== 'cross') return {part,dataUrl,size:512};
	// Roadscape has no palm cutout. Render one from the same generated palm, once per variant.
	const texture = await new Promise<THREE.Texture>((resolve,reject) => new THREE.TextureLoader().load(dataUrl,resolve,undefined,reject));
	texture.flipY = false;
	const material = new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,alphaTest:0.4});
	const geometry = geometryForParts([part]);
	const scene = new THREE.Scene(); scene.add(new THREE.Mesh(geometry,material));
	geometry.computeBoundingBox(); const box = geometry.boundingBox!;
	const width = Math.max(box.max.x-box.min.x,box.max.z-box.min.z)*1.1;
	const top = box.max.y*1.03;
	const camera = new THREE.OrthographicCamera(-width/2,width/2,top,0,0.1,100);
	camera.position.set(0,0,30); camera.lookAt(0,0,0);
	const renderer = new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
	try {
		renderer.setSize(512,512); renderer.setClearColor(0,0); renderer.render(scene,camera);
		return {part:crossPart(key,width,top),dataUrl:renderer.domElement.toDataURL('image/png'),size:512};
	} finally { geometry.dispose(); material.dispose(); texture.dispose(); renderer.dispose(); renderer.forceContextLoss(); }
}
export function treeAsset(t: PlacedTree): Promise<CityTreeAsset> {
	const key=treeKey(t); let value=cache.get(key);
	if (!value) { value=build(t).catch(error=>{cache.delete(key);throw error;}); cache.set(key,value); }
	return value;
}
export async function treeAssets(trees: PlacedTree[]): Promise<Map<string, CityTreeAsset>> {
	const unique = new Map(trees.map(t=>[treeKey(t),t]));
	const out = new Map<string,CityTreeAsset>();
	// Sequential generation avoids a burst of GPU contexts when making palm cutouts.
	for (const [key,t] of unique) out.set(key,await treeAsset(t));
	return out;
}
export function clearTreeAssets(): void { cache.clear(); }
