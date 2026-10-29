import licenses from '../texture/asset_licenses.json';
import type { GamePackage } from '../core/gameready/package';
import type { PlacedTree } from '../core/nature/scatter';
import { partToGlb } from '../core/gameready/gltf';
import { treeAssets, treeKey } from './tree_assets';

/** Add the exact displayed tree prefabs and cutouts to the portable package. */
export async function addTreesToPackage(pkg: GamePackage, trees: PlacedTree[]): Promise<void> {
	const assets = await treeAssets(trees);
	for (const [name,text] of Object.entries(licenses)) pkg.files.push({path:`licenses/${name}`,text});
	pkg.manifest.treeAssets = {};
	for (const [key,asset] of assets) {
		const triangles = asset.part.faces.reduce((n,f)=>n+f.indices.length-2,0);
		const mesh=`trees/${key}.glb`, texture=`trees/${key}.png`;
		pkg.files.push({path:mesh,bytes:partToGlb(asset.part,key,{baseColor:`${key}.png`,cutout:0.45,doubleSided:true})});
		pkg.files.push({path:texture,bytes:Uint8Array.from(atob(asset.dataUrl.split(',')[1]),c=>c.charCodeAt(0))});
		pkg.manifest.treeAssets[key]={mesh,texture,triangles};
	}
	pkg.manifest.trees.forEach((entry,i)=>{
		entry.asset=treeKey(trees[i]);
		pkg.report.cityTriangles+=pkg.manifest.treeAssets![entry.asset].triangles;
	});
	const manifest=pkg.files.find(f=>f.path==='city.json');
	if (manifest) manifest.text=JSON.stringify(pkg.manifest,null,1);
	pkg.files.push({path:'trees/README.txt',text:'Tree cards require two-sided rendering and alpha cutout (threshold 0.45). Model trees use Procedural Trees; distant broadleaf/conifer cutouts use Roadscape tree1–tree5 (GPL-3.0-or-later). Palm cutouts are rendered from Procedural Trees. See the plugin ASSETS.md for provenance.'});
}
