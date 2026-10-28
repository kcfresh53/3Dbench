import { disposeBody } from './live_render';
import { selectionMode } from './bb_access';

type PreviewObject = THREE.Mesh & {
	outline: THREE.LineSegments;
	vertex_points: THREE.Points;
};

interface Raycastable {
	raycast: (raycaster: THREE.Raycaster, hits: THREE.Intersection[]) => void;
}

export interface SurfaceMaterials {
	hidden: THREE.Material;
	outline: THREE.LineBasicMaterial;
	points: THREE.PointsMaterial;
}

/** Makes one control mesh show a generated road in its place while staying selectable and editable. */
export class LiveSurface {
	body: THREE.Group | null = null;
	private readonly object: PreviewObject;
	private readonly material: THREE.Material | THREE.Material[];
	private readonly raycast: Raycastable['raycast'];
	private active: boolean = false;
	private readonly edgeProxy: THREE.LineSegments & { vertex_order?: string[] };

	constructor(
		readonly mesh: Mesh,
		private readonly materials: SurfaceMaterials,
	) {
		this.object = mesh.mesh as PreviewObject;
		this.material = this.object.material;
		this.raycast = (this.object as unknown as Raycastable).raycast;
		this.edgeProxy = new THREE.LineSegments(new THREE.BufferGeometry(), materials.outline);
		(this.edgeProxy as unknown as { no_export: boolean }).no_export = true;
		this.object.add(this.edgeProxy);
	}

	/** True while the control mesh still owns the Three.js object this surface was built for. */
	valid(): boolean {
		return this.mesh.mesh === this.object;
	}

	show(body: THREE.Group): void {
		disposeBody(this.body);
		this.body = body;
		this.object.add(body);
		this.activate();
	}

	/** Shows the plain control mesh again, for example when generation fails. */
	showControl(): void {
		disposeBody(this.body);
		this.body = null;
		this.deactivate(true);
	}

	private activate(): void {
		this.active = true;
		this.object.material = this.materials.hidden;
		this.object.outline.material = this.materials.outline;
		this.object.vertex_points.material = this.materials.points;
		const surface: LiveSurface = this;
		// Clicking the road body still resolves to the control mesh, so the path stays editable.
		(this.object as unknown as Raycastable).raycast = function (this: THREE.Object3D, raycaster: THREE.Raycaster, hits: THREE.Intersection[]): void {
			const body: THREE.Group | null = surface.body;
			if (!Modes.edit || !body || ['face', 'cluster'].includes(selectionMode())) return;
			body.updateWorldMatrix(true, false);
			const found: THREE.Intersection[] = [];
			for (const child of body.children) child.raycast(raycaster, found);
			found.sort((a, b) => a.distance - b.distance);
			for (const hit of found.slice(0, 1)) {
				hit.object = this;
				hit.faceIndex = 0;
				// Native Mesh face picking cannot resolve a graph made of two-point
				// faces. Return a real control-point/edge hit instead of a fake face.
				if (surface.mesh.selected && selectionMode() === 'vertex') {
					const keys: string[] = Object.keys(surface.mesh.vertices);
					let best: number = Infinity;
					keys.forEach((key: string, index: number): void => {
						const point = surface.object.localToWorld(new THREE.Vector3(...surface.mesh.vertices[key]));
						const distance = point.distanceToSquared(hit.point);
						if (distance < best) { best = distance; hit.index = index; }
					});
					hit.object = surface.object.vertex_points;
				} else if (surface.mesh.selected && selectionMode() === 'edge') {
					let best: number = Infinity;
					let picked: string[] = [];
					for (const face of Object.values(surface.mesh.faces)) {
						if (face.vertices.length !== 2) continue;
						const [a, b] = face.vertices.map(key => surface.object.localToWorld(new THREE.Vector3(...surface.mesh.vertices[key])));
						const closest = new THREE.Line3(a, b).closestPointToPoint(hit.point, true, new THREE.Vector3());
						const distance = closest.distanceToSquared(hit.point);
						if (distance < best) { best = distance; picked = face.vertices.slice(); }
					}
					if (picked.length !== 2) continue;
					surface.edgeProxy.vertex_order = picked;
					hit.object = surface.edgeProxy;
					hit.index = 0;
				}
				hits.push(hit);
			}
		};
	}

	/** Re-applies the control outline materials after the native preview rebuilt its objects. */
	refreshSelection(): void {
		if (!this.body) return;
		this.object.outline.material = this.materials.outline;
		this.object.vertex_points.material = this.materials.points;
	}

	private deactivate(restoreMaterial: boolean): void {
		if (!this.active && !restoreMaterial) return;
		this.active = false;
		(this.object as unknown as Raycastable).raycast = this.raycast;
		if (this.object.material === this.materials.hidden) this.object.material = this.material as THREE.Material;
		if (this.object.outline) this.object.outline.material = Canvas.meshOutlineMaterial;
		if (this.object.vertex_points) this.object.vertex_points.material = Canvas.meshVertexMaterial;
	}

	dispose(): void {
		disposeBody(this.body);
		this.body = null;
		this.edgeProxy.removeFromParent();
		this.edgeProxy.geometry.dispose();
		this.deactivate(false);
	}
}

export function createSurfaceMaterials(): SurfaceMaterials {
	const outline: THREE.LineBasicMaterial = Canvas.meshOutlineMaterial.clone();
	const points: THREE.PointsMaterial = Canvas.meshVertexMaterial.clone();
	outline.depthTest = false;
	points.depthTest = false;
	return { hidden: new THREE.MeshBasicMaterial({ visible: false }), outline, points };
}

export function disposeSurfaceMaterials(materials: SurfaceMaterials): void {
	materials.hidden.dispose();
	materials.outline.dispose();
	materials.points.dispose();
}

