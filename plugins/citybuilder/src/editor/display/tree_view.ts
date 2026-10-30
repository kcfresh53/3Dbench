import type { PlacedTree } from '../../core/nature/scatter';
import { geometryForParts } from '../../../../roadscape/src/editor/live_render';
import { treeAssets, treeKey, clearTreeAssets } from '../tree_assets';
import type { CityTreeAsset } from '../tree_assets';
import { disposeTree, redraw, refreshShadows } from './gl';
import type { View, ViewContext } from './view';

/**
 * Side of one culling cell for detailed tree models, metres. Each cell is its own instanced mesh, so
 * off-screen models cost nothing. Cutout cards are only a few triangles each; they stay in one mesh per
 * species because extra draw calls would cost more than culling saves.
 */
const CHUNK_METRES: number = 96;
/** Tallest tree at its largest scale, metres; pads the culling sphere. */
const MAX_TREE_HEIGHT: number = 20;
/** Cell id of the single uncullable mesh that holds a species' cutout cards. */
const ALL_CELLS: string = 'all';

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
 * Trees as instanced meshes, one per species/variant/representation. Detailed models
 * stand near roads and two-card cutouts fill the distance (the scatter decides which). Models are split
 * into 96 m cells so the renderer can drop every one outside the camera's view.
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
		const groups: Map<string, Map<string, PlacedTree[]>> = new Map<string, Map<string, PlacedTree[]>>();
		for (const t of trees) {
			const key: string = treeKey(t);
			const cell: string = t.representation === 'model' ? `${Math.floor(t.x / CHUNK_METRES)}|${Math.floor(t.z / CHUNK_METRES)}` : ALL_CELLS;
			const byCell: Map<string, PlacedTree[]> = groups.get(key) ?? new Map<string, PlacedTree[]>();
			const list: PlacedTree[] = byCell.get(cell) ?? [];
			list.push(t);
			byCell.set(cell, list);
			groups.set(key, byCell);
		}
		const dummy: THREE.Object3D = new THREE.Object3D();
		const cullRadius: number = CHUNK_METRES * Math.SQRT1_2 + MAX_TREE_HEIGHT;
		for (const [key, byCell] of groups) {
			const asset: CityTreeAsset = assets.get(key) as CityTreeAsset;
			const material: THREE.MeshBasicMaterial = new THREE.MeshBasicMaterial({ map: this.textureFor(key, asset), side: THREE.DoubleSide, alphaTest: 0.45, toneMapped:false });
			// One geometry per asset, shared by its cells. Its sphere covers a whole cell around the mesh origin.
			const geometry: THREE.BufferGeometry = geometryForParts([asset.part]);
			// Cell meshes sit at their cell centre, so one shared sphere around the origin covers any cell.
			geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, MAX_TREE_HEIGHT / 2, 0), cullRadius);
			for (const [cell, list] of byCell) {
				const whole: boolean = cell === ALL_CELLS;
				const [cx, cz] = whole ? [0, 0] : cell.split('|').map((n: string): number => (Number(n) + 0.5) * CHUNK_METRES);
				const mesh: THREE.InstancedMesh = new THREE.InstancedMesh(geometry, material, list.length);
				mesh.position.set(cx, 0, cz);
				list.forEach((t: PlacedTree, i: number): void => {
					dummy.position.set(t.x - cx, t.y, t.z - cz);
					dummy.rotation.set(0, t.yaw, 0);
					dummy.scale.setScalar(t.scale);
					dummy.updateMatrix();
					mesh.setMatrixAt(i, dummy.matrix);
				});
				mesh.castShadow = true;
				mesh.instanceMatrix.needsUpdate = true;
				mesh.frustumCulled = !whole;
				this.root.add(mesh);
			}
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
