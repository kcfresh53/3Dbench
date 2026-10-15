import { THREE } from '../../../lib/libs';
import { Armature } from '../../../outliner/types/armature';
import { ArmatureBone } from '../../../outliner/types/armature_bone';
import { Skeleton, Pose, JointTransform } from '../core/skeleton';
import type { Vec3, Quat } from '../core/math';

export type BoneNode = Group | ArmatureBone;

interface AnimatedObject extends THREE.Object3D {
	fix_position?: THREE.Vector3;
	fix_rotation?: THREE.Euler;
}

export interface SceneJoint {
	node: BoneNode;
	object: AnimatedObject;
}

function isBone(node: unknown): node is BoneNode {
	return node instanceof Group || node instanceof ArmatureBone;
}

/**
 * Bridge between the bone hierarchy of the scene and the dependency free rig core.
 * Joints are all bones below the given roots. The pose space is the local space of the roots' parent
 * object (armature or model), so scene transforms above the skeleton don't matter.
 */
export class SceneSkeleton {
	readonly joints: SceneJoint[];
	readonly skeleton: Skeleton;
	/** Object whose local space the poses are expressed in */
	readonly space: THREE.Object3D;
	private readonly index_by_uuid: Map<string, number> = new Map();
	/** Changes whenever a rest transform changes, used to detect edits of the model */
	readonly signature: string;

	private constructor(joints: SceneJoint[], parents: number[], space: THREE.Object3D) {
		this.joints = joints;
		this.space = space;
		joints.forEach((joint: SceneJoint, i: number): void => { this.index_by_uuid.set(joint.node.uuid, i); });
		const bind: JointTransform[] = joints.map((joint: SceneJoint): JointTransform => SceneSkeleton.restTransform(joint.object));
		this.skeleton = new Skeleton(joints.map((joint: SceneJoint): string => joint.node.name), parents, bind);
		this.signature = joints.map((joint: SceneJoint): string => joint.node.uuid).join(',') + '|' +
			bind.reduce((sum: number, t: JointTransform): number => sum + t.position[0] + 3 * t.position[1] + 7 * t.position[2] + 11 * t.rotation[0] + 13 * t.rotation[1] + 17 * t.rotation[2], 0).toFixed(5);
	}

	/** Collects the bones below the given roots (an armature, or bones / groups) */
	static collect(roots: OutlinerNode[]): SceneSkeleton | null {
		const joints: SceneJoint[] = [];
		const parents: number[] = [];
		let space: THREE.Object3D | null = null;
		const visit = (node: OutlinerNode, parent: number): void => {
			if (!isBone(node)) return;
			const object: AnimatedObject | undefined = node.mesh as AnimatedObject | undefined;
			if (!object) return;
			if (parent < 0 && !space) space = object.parent;
			const index: number = joints.length;
			joints.push({ node, object });
			parents.push(parent);
			for (const child of node.children as OutlinerNode[]) visit(child, index);
		};
		for (const root of roots) {
			if (root instanceof Armature) {
				for (const child of root.children as OutlinerNode[]) visit(child, -1);
			} else {
				visit(root, -1);
			}
		}
		if (!joints.length || !space) return null;
		return new SceneSkeleton(joints, parents, space);
	}

	indexOfUuid(uuid: string): number {
		return this.index_by_uuid.get(uuid) ?? -1;
	}

	/** Rest transform of a bone, independent of the animation currently shown */
	private static restTransform(object: AnimatedObject): JointTransform {
		const position: THREE.Vector3 = object.fix_position ?? object.position;
		const euler: THREE.Euler = object.fix_rotation ?? object.rotation;
		const quaternion: THREE.Quaternion = new THREE.Quaternion().setFromEuler(euler);
		return { position: [position.x, position.y, position.z], rotation: [quaternion.x, quaternion.y, quaternion.z, quaternion.w] };
	}

	/** Reads the transforms currently displayed on the bones (rest pose plus animation) */
	readAnimated(): Pose {
		const local: JointTransform[] = this.joints.map((joint: SceneJoint): JointTransform => {
			const p: THREE.Vector3 = joint.object.position;
			const q: THREE.Quaternion = joint.object.quaternion;
			return { position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] };
		});
		return new Pose(this.skeleton, local);
	}

	/** Writes every joint of a pose back to the scene bones */
	writeAll(pose: Pose): void {
		this.joints.forEach((joint: SceneJoint, i: number): void => this.writeJoint(joint, pose.local[i]));
	}

	/** Writes only the joints that differ from the reference pose (the solved ones) */
	writeChanged(pose: Pose, reference: Pose, epsilon: number = 1e-7): void {
		this.joints.forEach((joint: SceneJoint, i: number): void => {
			const a: JointTransform = pose.local[i];
			const b: JointTransform = reference.local[i];
			const same: boolean =
				Math.abs(a.position[0] - b.position[0]) < epsilon && Math.abs(a.position[1] - b.position[1]) < epsilon && Math.abs(a.position[2] - b.position[2]) < epsilon &&
				Math.abs(a.rotation[0] - b.rotation[0]) < epsilon && Math.abs(a.rotation[1] - b.rotation[1]) < epsilon &&
				Math.abs(a.rotation[2] - b.rotation[2]) < epsilon && Math.abs(a.rotation[3] - b.rotation[3]) < epsilon;
			if (!same) this.writeJoint(joint, a);
		});
	}

	private writeJoint(joint: SceneJoint, transform: JointTransform): void {
		joint.object.position.set(transform.position[0], transform.position[1], transform.position[2]);
		joint.object.quaternion.set(transform.rotation[0], transform.rotation[1], transform.rotation[2], transform.rotation[3]);
		joint.object.matrixWorldNeedsUpdate = true;
	}

	/** Resets every bone to its rest transform */
	resetToRest(): void {
		for (const joint of this.joints) {
			if (joint.object.fix_rotation) joint.object.rotation.copy(joint.object.fix_rotation);
			if (joint.object.fix_position) joint.object.position.copy(joint.object.fix_position);
		}
	}

	/** Converts a scene world position to the pose space */
	toPoseSpace(world: THREE.Vector3): Vec3 {
		this.space.updateWorldMatrix(true, false);
		const local: THREE.Vector3 = this.space.worldToLocal(world.clone());
		return [local.x, local.y, local.z];
	}

	fromPoseSpace(position: Vec3): THREE.Vector3 {
		this.space.updateWorldMatrix(true, false);
		return this.space.localToWorld(new THREE.Vector3(position[0], position[1], position[2]));
	}

	/** World quaternion of the pose space, used to bring world rotations into it */
	spaceRotationInverse(): THREE.Quaternion {
		return this.space.getWorldQuaternion(new THREE.Quaternion()).invert();
	}

	toPoseRotation(world: THREE.Quaternion): Quat {
		const q: THREE.Quaternion = this.spaceRotationInverse().multiply(world);
		return [q.x, q.y, q.z, q.w];
	}

	/** Euler rotation delta in degrees that turns the rest rotation of a joint into the given local rotation */
	eulerDelta(joint: number, rotation: Quat): Vec3 {
		const object: AnimatedObject = this.joints[joint].object;
		const rest: THREE.Euler = object.fix_rotation ?? object.rotation;
		const euler: THREE.Euler = new THREE.Euler(0, 0, 0, rest.order).setFromQuaternion(new THREE.Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]), rest.order);
		return [THREE.MathUtils.radToDeg(euler.x - rest.x), THREE.MathUtils.radToDeg(euler.y - rest.y), THREE.MathUtils.radToDeg(euler.z - rest.z)];
	}

	positionDelta(joint: number, position: Vec3): Vec3 {
		const object: AnimatedObject = this.joints[joint].object;
		const rest: THREE.Vector3 = object.fix_position ?? object.position;
		return [position[0] - rest.x, position[1] - rest.y, position[2] - rest.z];
	}
}
