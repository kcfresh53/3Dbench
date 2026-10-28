import { obbCorners } from '../../core/geometry2d';
import type { Lot } from '../../core/lots/types';
import { disposeTree } from './gl';
import type { View, ViewContext } from './view';

/** Outlines every lot: green where a building stands, amber where it is still empty. */
export class LotView implements View {
	readonly root: THREE.Object3D = new THREE.Object3D();

	rebuild(ctx: ViewContext): void {
		disposeTree(this.root);
		const built: Set<string> = new Set<string>(ctx.plan.buildings.map((b): string => b.lotId));
		const positions: number[] = [];
		const colors: number[] = [];
		const heights = ctx.plan.terrain.heights;
		for (const lot of ctx.plan.lots as Lot[]) {
			const corners = obbCorners(lot.obb);
			const color: number[] = built.has(lot.id) ? [0.45, 0.9, 0.45] : [0.95, 0.75, 0.25];
			for (let i: number = 0; i < 4; i++) {
				const a = corners[i];
				const b = corners[(i + 1) % 4];
				// Follow the ground along each edge so outlines never sink into slopes.
				const steps: number = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
				for (let s: number = 0; s < steps; s++) {
					const x0: number = a[0] + ((b[0] - a[0]) * s) / steps;
					const z0: number = a[1] + ((b[1] - a[1]) * s) / steps;
					const x1: number = a[0] + ((b[0] - a[0]) * (s + 1)) / steps;
					const z1: number = a[1] + ((b[1] - a[1]) * (s + 1)) / steps;
					positions.push(x0, heights.sample(x0, z0) + 0.3, z0, x1, heights.sample(x1, z1) + 0.3, z1);
					colors.push(...color, ...color);
				}
			}
		}
		const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
		const lines: THREE.LineSegments = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true }));
		lines.frustumCulled = false;
		this.root.add(lines);
	}

	dispose(): void {
		disposeTree(this.root);
	}
}
