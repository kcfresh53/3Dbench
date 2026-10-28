import type { View, ViewContext } from './view';
import { disposeTree } from './gl';

/** A translucent sheet at the water level, larger than the map so the shoreline never shows an edge. */
export class WaterView implements View {
	readonly root: THREE.Object3D = new THREE.Object3D();

	rebuild(ctx: ViewContext): void {
		disposeTree(this.root);
		const hf = ctx.plan.terrain.heights;
		const size: number = Math.max(hf.width, hf.depth) * 2;
		const plane: THREE.Mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(size, size),
			new THREE.MeshBasicMaterial({ color: 0x3f86b5, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide }),
		);
		plane.rotation.x = -Math.PI / 2;
		plane.position.y = ctx.state.settings.waterLevel;
		plane.renderOrder = 1;
		this.root.add(plane);
	}

	dispose(): void {
		disposeTree(this.root);
	}
}
