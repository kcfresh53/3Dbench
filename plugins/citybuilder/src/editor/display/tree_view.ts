import type { PlacedTree } from '../../core/nature/scatter';
import { geometryForParts } from '../../../../roadscape/src/editor/live_render';
import { treeAssets, treeKey, clearTreeAssets } from '../tree_assets';
import type { CityTreeAsset } from '../tree_assets';
import { disposeTree, redraw, refreshShadows } from './gl';
import type { View, ViewContext } from './view';

/** Cheap fingerprint of a tree list, so edits that leave the trees alone do not rebuild them. */
function treesSignature(trees: PlacedTree[]): string {
	let hash: number = 2166136261;
	const mix = (value: number): void => {
		hash = Math.imul(hash ^ Math.round(value * 100), 16777619) >>> 0;
	};
	for (const t of trees) {
		mix(t.x);
		mix(t.y);
		mix(t.z);
		mix(t.yaw);
		mix(t.scale);
		mix(t.variant);
		mix(t.representation === 'model' ? 1 : 2);
		mix(t.preset.length);
	}
	return `${trees.length}:${hash}`;
}

/**
 * Trees as instanced meshes, exactly one per species/variant/representation group, so every group is a
 * single draw call. Detailed models stand near roads and two-card cutouts fill the distance (the scatter
 * decides which). Groups are not split into culling cells: one call for the whole group costs less than
 * the per-cell calls it would save, so the mesh is always submitted.
 */
export class TreeView implements View {
	readonly root: THREE.Object3D = new THREE.Object3D();
	private readonly textures: Map<string, THREE.Texture> = new Map<string, THREE.Texture>();
	private revision: number = 0;
	private signature: string = '';

	rebuild(ctx: ViewContext): void {
		const signature: string = treesSignature(ctx.plan.trees);
		if (signature === this.signature) return;
		const revision: number = ++this.revision;
		this.signature = signature;
		void treeAssets(ctx.plan.trees)
			.then((assets: Map<string, CityTreeAsset>): void => {
				if (revision !== this.revision) return;
				disposeTree(this.root);
				this.build(ctx.plan.trees, assets);
				refreshShadows();
				redraw();
			})
			.catch((error: unknown): void => {
				this.signature = '';
				console.error('City Builder tree generation failed', error);
			});
	}

	private build(trees: PlacedTree[], assets: Map<string, CityTreeAsset>): void {
		const groups: Map<string, PlacedTree[]> = new Map<string, PlacedTree[]>();
		for (const t of trees) {
			const key: string = treeKey(t);
			const list: PlacedTree[] = groups.get(key) ?? [];
			list.push(t);
			groups.set(key, list);
		}
		const dummy: THREE.Object3D = new THREE.Object3D();
		for (const [key, list] of groups) {
			const asset: CityTreeAsset = assets.get(key) as CityTreeAsset;
			const material: THREE.MeshBasicMaterial = new THREE.MeshBasicMaterial({ map: this.textureFor(key, asset), side: THREE.DoubleSide, alphaTest: 0.45, toneMapped: false });
			const geometry: THREE.BufferGeometry = geometryForParts([asset.part]);
			const mesh: THREE.InstancedMesh = new THREE.InstancedMesh(geometry, material, list.length);
			list.forEach((t: PlacedTree, i: number): void => {
				dummy.position.set(t.x, t.y, t.z);
				dummy.rotation.set(0, t.yaw, 0);
				dummy.scale.setScalar(t.scale);
				dummy.updateMatrix();
				mesh.setMatrixAt(i, dummy.matrix);
			});
			mesh.castShadow = true;
			mesh.instanceMatrix.needsUpdate = true;
			// A group spans the whole city, so its bounds would never cull; skip the per-frame test.
			mesh.frustumCulled = false;
			this.root.add(mesh);
		}
	}

	private textureFor(key: string, asset: CityTreeAsset): THREE.Texture {
		let texture: THREE.Texture | undefined = this.textures.get(key);
		if (!texture) {
			texture = new THREE.TextureLoader().load(asset.dataUrl, (): void => redraw());
			texture.encoding=THREE.sRGBEncoding;
			texture.flipY = false;
			texture.magFilter = THREE.LinearFilter;
			texture.minFilter = THREE.LinearMipmapLinearFilter;
			texture.anisotropy = 4;
			this.textures.set(key, texture);
		}
		return texture;
	}

	dispose(): void {
		this.revision++;
		this.signature = '';
		disposeTree(this.root);
		for (const texture of this.textures.values()) texture.dispose();
		this.textures.clear();
		clearTreeAssets();
	}
}
