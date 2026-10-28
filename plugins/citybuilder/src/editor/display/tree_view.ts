import type { PlacedTree } from '../../core/nature/scatter';
import { geometryForParts } from '../../../../roadscape/src/editor/live_render';
import { treeAssets, treeKey, clearTreeAssets } from '../tree_assets';
import { disposeTree } from './gl';
import type { View, ViewContext } from './view';

/** Shared instanced meshes by species, variant and distance from road edges. */
export class TreeView implements View {
	readonly root = new THREE.Object3D();
	private textures = new Map<string, THREE.Texture>();
	private revision = 0;
	rebuild(ctx: ViewContext): void {
		const revision = ++this.revision;
		disposeTree(this.root);
		void treeAssets(ctx.plan.trees).then(assets => {
			if (revision !== this.revision) return;
			const groups = new Map<string, PlacedTree[]>();
			for (const t of ctx.plan.trees) { const key=treeKey(t); const list=groups.get(key)??[]; list.push(t);groups.set(key,list); }
			const dummy = new THREE.Object3D();
			for (const [key,list] of groups) {
				const asset=assets.get(key)!;
				let texture=this.textures.get(key);
				if (!texture) {
					texture=new THREE.TextureLoader().load(asset.dataUrl,()=>Canvas.updateAll());
					texture.flipY=false; texture.magFilter=THREE.LinearFilter;
					texture.minFilter=THREE.LinearMipmapLinearFilter; texture.anisotropy=4;
					this.textures.set(key,texture);
				}
				const material=new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,alphaTest:0.45});
				const mesh=new THREE.InstancedMesh(geometryForParts([asset.part]),material,list.length);
				list.forEach((t,i)=>{dummy.position.set(t.x,t.y,t.z);dummy.rotation.set(0,t.yaw,0);dummy.scale.setScalar(t.scale);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);});
				mesh.instanceMatrix.needsUpdate=true;mesh.frustumCulled=false;this.root.add(mesh);
			}
			Canvas.updateAll();
		}).catch(error=>console.error('City Builder tree generation failed',error));
	}
	dispose(): void {
		this.revision++;disposeTree(this.root);
		for(const texture of this.textures.values())texture.dispose();
		this.textures.clear();clearTreeAssets();
	}
}
