import type { Heightfield } from '../../core/terrain/heightfield';
import type { Vec2 } from '../../core/types';
import { disposeTree } from './gl';

const MAX_POINTS: number = 256;

/** A line that hugs the ground: the brush ring, a rectangle being dragged or a polygon being drawn. */
export class CursorView {
	readonly root: THREE.Object3D = new THREE.Object3D();
	private readonly line: THREE.Line;
	private readonly positions: Float32Array = new Float32Array(MAX_POINTS * 3);

	constructor() {
		const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
		this.line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
		this.line.frustumCulled = false;
		this.line.renderOrder = 10;
		this.root.add(this.line);
		this.root.visible = false;
	}

	hide(): void {
		this.root.visible = false;
	}

	/** Draws a path of ground positions, optionally closed. Long paths are thinned to fit. */
	path(hf: Heightfield, points: Vec2[], closed: boolean, color: number): void {
		const list: Vec2[] = closed && points.length > 0 ? [...points, points[0]] : points;
		const count: number = Math.min(list.length, MAX_POINTS);
		for (let i: number = 0; i < count; i++) {
			const p: Vec2 = list[Math.floor((i * (list.length - 1)) / Math.max(1, count - 1))];
			this.positions[i * 3] = p[0];
			this.positions[i * 3 + 1] = hf.sample(p[0], p[1]) + 0.4;
			this.positions[i * 3 + 2] = p[1];
		}
		this.line.geometry.setDrawRange(0, count);
		(this.line.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
		(this.line.material as THREE.LineBasicMaterial).color.setHex(color);
		this.root.visible = count > 1;
	}

	/** The brush footprint around a point. */
	brush(hf: Heightfield, x: number, z: number, radius: number, shape: 'round' | 'square', color: number): void {
		const points: Vec2[] = [];
		const segments: number = 72;
		for (let i: number = 0; i < segments; i++) {
			const a: number = (i / segments) * Math.PI * 2;
			const m: number = shape === 'square' ? Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))) : 1;
			points.push([x + (Math.cos(a) / m) * radius, z + (Math.sin(a) / m) * radius]);
		}
		this.path(hf, points, true, color);
	}

	/** Axis-aligned rectangle between two corners, drawn with extra points along the edges so it follows the ground. */
	rect(hf: Heightfield, x0: number, z0: number, x1: number, z1: number, color: number): void {
		const corners: Vec2[] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
		const points: Vec2[] = [];
		for (let i: number = 0; i < 4; i++) {
			const a: Vec2 = corners[i];
			const b: Vec2 = corners[(i + 1) % 4];
			const steps: number = Math.max(1, Math.min(30, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / hf.cellSize)));
			for (let s: number = 0; s < steps; s++) points.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
		}
		this.path(hf, points, true, color);
	}

	dispose(): void {
		disposeTree(this.root);
	}
}
