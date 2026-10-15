import { THREE } from '../../../lib/libs';
import type { Vec3, Quat } from '../core/math';
import type { GroundProvider, GroundSample, HandleState, ExternalTransform } from '../modifiers/rule_context';
import type { IKRigProjectData } from './ik_rig_data';
import type { SceneSkeleton } from './scene_skeleton';

/** Terrain provider working in pose space on top of a function that answers in scene world space */
class PoseSpaceGround implements GroundProvider {
	readonly reference_height: number;
	private readonly scene: SceneSkeleton;
	private readonly query: (x: number, z: number) => { height: number; normal: THREE.Vector3 } | null;
	private readonly flat_height: number;

	constructor(scene: SceneSkeleton, flat_world_height: number, query: (x: number, z: number) => { height: number; normal: THREE.Vector3 } | null) {
		this.scene = scene;
		this.query = query;
		this.flat_height = flat_world_height;
		this.reference_height = scene.toPoseSpace(new THREE.Vector3(0, flat_world_height, 0))[1];
	}

	sample(x: number, z: number): GroundSample {
		const world: THREE.Vector3 = this.scene.fromPoseSpace([x, this.reference_height, z]);
		const hit = this.query(world.x, world.z);
		if (!hit) return { height: this.reference_height, normal: [0, 1, 0] };
		const surface: Vec3 = this.scene.toPoseSpace(new THREE.Vector3(world.x, hit.height, world.z));
		const normal: THREE.Vector3 = hit.normal.clone().transformDirection(new THREE.Matrix4().copy(this.scene.space.matrixWorld).invert());
		return { height: surface[1], normal: [normal.x, normal.y, normal.z] };
	}
}

/** Flat floor, or the surface of chosen scene elements (found by casting rays downwards) */
export function createGroundProvider(scene: SceneSkeleton, data: IKRigProjectData): GroundProvider {
	if (data.ground.mode == 'objects') {
		const targets: THREE.Object3D[] = [];
		for (const uuid of data.ground.objects) {
			const node = OutlinerNode.uuids[uuid];
			if (node && node.mesh) targets.push(node.mesh);
		}
		if (targets.length) {
			const raycaster: THREE.Raycaster = new THREE.Raycaster();
			const origin: THREE.Vector3 = new THREE.Vector3();
			const down: THREE.Vector3 = new THREE.Vector3(0, -1, 0);
			const top: number = new THREE.Box3().setFromObject(targets[0]).max.y;
			const ceiling: number = targets.reduce((max: number, t: THREE.Object3D): number => Math.max(max, new THREE.Box3().setFromObject(t).max.y), top) + 1;
			return new PoseSpaceGround(scene, data.ground.height, (x: number, z: number) => {
				raycaster.set(origin.set(x, ceiling, z), down);
				const hits = raycaster.intersectObjects(targets, true);
				const hit = hits.find((h) => h.face);
				if (!hit || !hit.face) return null;
				return { height: hit.point.y, normal: hit.face.normal.clone().transformDirection(hit.object.matrixWorld) };
			});
		}
	}
	return new PoseSpaceGround(scene, data.ground.height, () => ({ height: data.ground.height, normal: new THREE.Vector3(0, 1, 0) }));
}

/** 0..1 influence of an animated handle at a time: full between its first and last keyframe, fading outside */
export function handleInfluence(times: number[], time: number, blend: number): number {
	if (!times.length) return 0;
	const first: number = Math.min(...times);
	const last: number = Math.max(...times);
	if (time >= first && time <= last) return 1;
	if (blend <= 1e-6) return 0;
	const distance: number = time < first ? first - time : time - last;
	const t: number = Math.max(0, 1 - distance / blend);
	return t * t * (3 - 2 * t);
}

/** Handles are null objects; they only take effect while they have keyframes in the animation */
export function createHandleProvider(scene: SceneSkeleton, data: IKRigProjectData, animation: BBAnimation | null, time: number): (goal_id: string) => HandleState | null {
	return (goal_id: string): HandleState | null => {
		const uuid: string | undefined = data.handles[goal_id];
		const handle = uuid ? OutlinerNode.uuids[uuid] : undefined;
		if (!handle || !(handle instanceof NullObject) || !animation) return null;
		const animator = animation.animators[uuid as string];
		const keys: BBKeyframe[] = animator && animator.position ? animator.position : [];
		const weight: number = handleInfluence(keys.map((k: BBKeyframe): number => k.time), time, data.handle_blend);
		if (weight <= 0) return null;
		const identity: Quat = [0, 0, 0, 1];
		const animated = handle as NullObject & { getWorldCenter(with_animation: boolean): THREE.Vector3 };
		return { position: scene.toPoseSpace(animated.getWorldCenter(true)), rotation: identity, weight, has_rotation: false };
	};
}

/** Attachments are any scene nodes; the goal follows their world transform */
export function createAttachmentProvider(scene: SceneSkeleton): (attachment_id: string) => ExternalTransform | null {
	return (attachment_id: string): ExternalTransform | null => {
		const node = OutlinerNode.uuids[attachment_id];
		if (!node || !node.mesh) return null;
		const position: THREE.Vector3 = node.mesh.getWorldPosition(new THREE.Vector3());
		const rotation: THREE.Quaternion = node.mesh.getWorldQuaternion(new THREE.Quaternion());
		return { position: scene.toPoseSpace(position), rotation: scene.toPoseRotation(rotation) };
	};
}
