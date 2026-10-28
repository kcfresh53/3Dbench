import type { Vec3 } from '../core/types';
import type { DraftAnchor } from '../core/network_edit';

interface BezierPath {
	points: THREE.Vector3[];
	connections: boolean[];
}

interface SplineLike {
	type: string;
	cyclic?: boolean;
	mesh: THREE.Object3D;
	getBézierPath(): BezierPath;
}

const MAX_SAMPLES: number = 64;

/** True when the element is a native spline. */
export function isSpline(element: unknown): boolean {
	return !!element && (element as { type?: string }).type === 'spline';
}

/** Samples a continuous native spline into world-space draft points. */
export function splineAnchors(spline: unknown): { anchors: DraftAnchor[]; closed: boolean } {
	const source: SplineLike = spline as SplineLike;
	const data: BezierPath = source.getBézierPath();
	if (data.points.length < 2 || data.connections.slice(0, -1).some((connected: boolean): boolean => !connected)) throw new Error('Select one continuous spline path.');
	source.mesh.updateWorldMatrix(true, false);
	const count: number = Math.min(MAX_SAMPLES, data.points.length);
	const anchors: DraftAnchor[] = [];
	for (let i: number = 0; i < count; i++) {
		const point: THREE.Vector3 = data.points[Math.round((i * (data.points.length - 1)) / Math.max(1, count - 1))].clone();
		source.mesh.localToWorld(point);
		const position: Vec3 = [point.x, point.y, point.z];
		const last: DraftAnchor | undefined = anchors[anchors.length - 1];
		if (!last || Math.hypot(position[0] - last.position[0], position[2] - last.position[2]) > 0.001) anchors.push({ position, snap: { type: 'free' } });
	}
	return { anchors, closed: !!source.cyclic };
}
