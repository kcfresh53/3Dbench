import type { PlacedBuilding } from '../../core/city/compose';
import { modularMesh } from '../../core/buildings/mesh';
import type { Prefab } from '../../core/buildings/prefabs';
import { tileUv } from '../../core/buildings/tiles';
import { TILE_MATERIAL } from '../../core/buildings/mesh';
import type { Vec2 } from '../../core/types';
import { paintBuildingAtlas } from '../../texture/tile_painters';
import { disposeTree, propGeometry, rasterTexture } from './gl';
import type { View, ViewContext } from './view';

/** Past this many buildings the live view drops foundation rows to stay light. */
const LOD_SWITCH: number = 1500;

/** Every building, drawn as one instanced mesh per distinct building model. */
export class BuildingView implements View {
	readonly root: THREE.Object3D = new THREE.Object3D();
	private material: THREE.MeshBasicMaterial | null = null;

	rebuild(ctx: ViewContext): void {
		this.clear();
		const plan = ctx.plan;
		if (plan.buildings.length === 0) return;
		this.material = new THREE.MeshBasicMaterial({ map: rasterTexture(paintBuildingAtlas(), true), side: THREE.DoubleSide, alphaTest: 0.5 });
		const groups: Map<string, PlacedBuilding[]> = new Map<string, PlacedBuilding[]>();
		for (const b of plan.buildings) {
			const list: PlacedBuilding[] = groups.get(b.prefab) ?? [];
			list.push(b);
			groups.set(b.prefab, list);
		}
		const lod: 0 | 1 = plan.buildings.length > LOD_SWITCH ? 1 : 0;
		const byKey: Map<string, Prefab> = new Map<string, Prefab>(plan.prefabs.all().map((p: Prefab): [string, Prefab] => [p.key, p]));
		const up: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
		const one: THREE.Vector3 = new THREE.Vector3(1, 1, 1);
		const q: THREE.Quaternion = new THREE.Quaternion();
		const pos: THREE.Vector3 = new THREE.Vector3();
		const m: THREE.Matrix4 = new THREE.Matrix4();
		for (const [key, list] of groups) {
			const prefab: Prefab | undefined = byKey.get(key);
			if (!prefab) continue;
			const geometry: THREE.BufferGeometry = propGeometry(modularMesh(prefab.model, lod), (material: string, uv: Vec2): Vec2 =>
				material.startsWith(TILE_MATERIAL) ? tileUv(Number(material.slice(TILE_MATERIAL.length)), uv[0], uv[1]) : uv,
			);
			const instanced: THREE.InstancedMesh = new THREE.InstancedMesh(geometry, this.material, list.length);
			list.forEach((b: PlacedBuilding, i: number): void => {
				q.setFromAxisAngle(up, b.yaw);
				pos.set(b.x, b.y, b.z);
				m.compose(pos, q, one);
				instanced.setMatrixAt(i, m);
			});
			instanced.instanceMatrix.needsUpdate = true;
			instanced.frustumCulled = false;
			this.root.add(instanced);
		}
	}

	private clear(): void {
		this.material?.map?.dispose();
		disposeTree(this.root);
		this.material = null;
	}

	dispose(): void {
		this.clear();
	}
}
