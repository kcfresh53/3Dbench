import { foundationMesh } from '../../core/buildings/foundations';
import { materialPlate } from '../../texture/ambientcg';
import type { PlacedBuilding } from '../../core/city/compose';
import { modularMesh } from '../../core/buildings/mesh';
import type { Prefab } from '../../core/buildings/prefabs';
import { detailTriangles } from '../../core/buildings/facade_detail';
import { TILE_MATERIAL } from '../../core/buildings/mesh';
import type { Vec2 } from '../../core/types';
import { sharedTileAtlas } from '../../texture/tile_painters';
import type { TileAtlas } from '../../texture/tile_painters';
import { disposeTree, mappedTexture, propGeometry, redraw } from './gl';
import type { View, ViewContext } from './view';

/** Above this many triangles the live view shows flat facades instead of the real facade modules, so big cities stay smooth. */
const TRIANGLE_BUDGET: number = 1_200_000;

/** Every building, drawn as one instanced mesh per distinct building model. */
export class BuildingView implements View {
	readonly root: THREE.Object3D = new THREE.Object3D();
	private material: THREE.MeshStandardMaterial | null = null;
	private foundationTextures: THREE.Texture[] = [];
	private envHandles: Array<{ delete(): void }> = [];

	rebuild(ctx: ViewContext): void {
		this.clear();
		const plan = ctx.plan;
		if (plan.buildings.length === 0) return;
		const byKey: Map<string, Prefab> = new Map<string, Prefab>(plan.prefabs.all().map((p: Prefab): [string, Prefab] => [p.key, p]));
		const lod: 0 | 1 = this.estimateTriangles(plan.buildings, byKey) > TRIANGLE_BUDGET ? 1 : 0;
		const meshes: Map<string, ReturnType<typeof modularMesh>> = new Map();
		const refs: Set<number> = new Set<number>();
		for (const prefab of byKey.values()) {
			const mesh = modularMesh(prefab.model, lod);
			meshes.set(prefab.key, mesh);
			for (const face of mesh.faces) if (face.material.startsWith(TILE_MATERIAL)) refs.add(Number(face.material.slice(TILE_MATERIAL.length)));
		}
		const atlas: TileAtlas = sharedTileAtlas();
		atlas.ensure(refs);
		this.material = this.createMaterial(atlas);
		const groups: Map<string, PlacedBuilding[]> = new Map<string, PlacedBuilding[]>();
		for (const b of plan.buildings) {
			const list: PlacedBuilding[] = groups.get(b.prefab) ?? [];
			list.push(b);
			groups.set(b.prefab, list);
		}
		const up: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
		const one: THREE.Vector3 = new THREE.Vector3(1, 1, 1);
		const q: THREE.Quaternion = new THREE.Quaternion();
		const pos: THREE.Vector3 = new THREE.Vector3();
		const m: THREE.Matrix4 = new THREE.Matrix4();
		for (const [key, list] of groups) {
			const prefab: Prefab | undefined = byKey.get(key);
			if (!prefab) continue;
			const geometry: THREE.BufferGeometry = propGeometry(meshes.get(key) ?? modularMesh(prefab.model, lod), (material: string, uv: Vec2): Vec2 =>
				material.startsWith(TILE_MATERIAL) ? atlas.uv(Number(material.slice(TILE_MATERIAL.length)), uv[0], uv[1]) : uv,
			);
			// Faces are separate triangles, so these are flat normals; the occlusion map reads the second UV set.
			// propGeometry keeps analytic normals on rounded glass and flat normals on trim.
			geometry.setAttribute('uv2', geometry.getAttribute('uv'));
			const instanced: THREE.InstancedMesh = new THREE.InstancedMesh(geometry, this.material, list.length);
			list.forEach((b: PlacedBuilding, i: number): void => {
				q.setFromAxisAngle(up, b.yaw);
				pos.set(b.x, b.y, b.z);
				one.fromArray(b.scale ?? [1, 1, 1]);
				m.compose(pos, q, one);
				instanced.setMatrixAt(i, m);
			});
			instanced.castShadow = true;
			instanced.receiveShadow = true;
			instanced.instanceMatrix.needsUpdate = true;
			instanced.frustumCulled = false;
			this.root.add(instanced);
		}
  const foundation=foundationMesh(plan.buildings,plan.terrain.heights);
  if(foundation.faces.length) {
   const maps = (['albedo','normal','orm'] as const).map(channel=>{
    const p=materialPlate('plaster',channel), texture=new THREE.DataTexture(p.data,p.w,p.h,THREE.RGBFormat);
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.flipY=false;texture.generateMipmaps=true;
    texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.anisotropy=16;
    if(channel==='albedo')texture.encoding=THREE.sRGBEncoding;
    texture.needsUpdate=true;this.foundationTextures.push(texture);return texture;
   });
   const geometry=propGeometry({positions:foundation.positions,faces:foundation.faces.map(f=>({...f,material:''}))},(_,uv)=>uv);
   geometry.setAttribute('uv2',geometry.getAttribute('uv'));
   const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({map:maps[0],normalMap:maps[1],roughnessMap:maps[2],aoMap:maps[2],roughness:1,metalness:0}));
   mesh.castShadow=true;mesh.receiveShadow=true;this.root.add(mesh);
  }
	}

	/**
	 * Walls are lit PBR: albedo plus a roughness/metallic/occlusion page and normals, reflecting a procedural sky,
	 * which is what makes the glass read as glass. Only the tiles the city uses are painted.
	 */
	private createMaterial(atlas: TileAtlas): THREE.MeshStandardMaterial {
		const renderer = typeof Preview !== 'undefined' ? (Preview.selected as unknown as { renderer?: THREE.WebGLRenderer } | undefined)?.renderer : undefined;
		const anisotropy: number = Math.min(8, renderer?.capabilities.getMaxAnisotropy() ?? 4);
		const srgb: boolean = true;
		const orm: THREE.DataTexture = mappedTexture(atlas.maps.orm, { srgb: false, anisotropy });
		const material: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
			map: mappedTexture(atlas.maps.albedo, { srgb, anisotropy }),
			normalMap: mappedTexture(atlas.maps.normal, { srgb: false, anisotropy }),
			roughnessMap: orm,
			metalnessMap: orm,
			aoMap: orm,
			roughness: 1,
			metalness: 1,
			envMapIntensity: 1,
			side: THREE.DoubleSide,
		});
		// Reflections come from whichever preview scene is active, like every other material in the viewport.
		const follow = (): void => {
			material.envMap = typeof PreviewScene !== 'undefined' ? PreviewScene.active?.cubemap ?? null : null;
			material.needsUpdate = true;
			if (typeof Canvas !== 'undefined') redraw();
		};
		follow();
		this.envHandles = typeof Blockbench === 'undefined' ? [] : [Blockbench.on('select_preview_scene', follow) as never, Blockbench.on('unselect_preview_scene', follow) as never];
		return material;
	}

	/** Triangles on screen if every building used its finest mesh. Cheap: facade detail is counted, not built. */
	private estimateTriangles(buildings: PlacedBuilding[], byKey: Map<string, Prefab>): number {
		const perPrefab: Map<string, number> = new Map<string, number>();
		let total: number = 0;
		for (const b of buildings) {
			let tris: number | undefined = perPrefab.get(b.prefab);
			if (tris === undefined) {
				const prefab: Prefab | undefined = byKey.get(b.prefab);
				tris = 800 + (prefab ? detailTriangles(prefab.model) : 0);
				perPrefab.set(b.prefab, tris);
			}
			total += tris;
		}
		return total;
	}

	private clear(): void {
		const m: THREE.MeshStandardMaterial | null = this.material;
		if (m) {
			m.map?.dispose();
			m.normalMap?.dispose();
			m.roughnessMap?.dispose();
		}
		for (const handle of this.envHandles) handle.delete();
		this.envHandles = [];
		for(const texture of this.foundationTextures)texture.dispose();this.foundationTextures=[];
		disposeTree(this.root);
		this.material = null;
	}

	dispose(): void {
		this.clear();
	}
}
