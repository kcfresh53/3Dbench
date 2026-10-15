import { Skeleton } from './skeleton';
import { Vec3, normalize, length } from './math';
import type { IKRigConfig, JointKey, GoalConfig } from './rig_types';

/** Resolves the joint keys of a rig config to joint indices of one skeleton and derives bind pose measurements */
export class RigBinding {
	readonly skeleton: Skeleton;
	readonly config: IKRigConfig;
	private readonly joints: Map<JointKey, number>;
	/** World height of the lowest foot / toe joint in the bind pose */
	readonly ground_level: number;
	/** Height of the pelvis above the ground in the bind pose. All distance thresholds are relative to this. */
	readonly body_scale: number;
	/** Horizontal facing direction of the bind pose (unit) */
	readonly forward: Vec3;

	constructor(skeleton: Skeleton, config: IKRigConfig, joints: Record<JointKey, number>) {
		this.skeleton = skeleton;
		this.config = config;
		this.joints = new Map(Object.entries(joints));

		const foot_effectors: number[] = config.goals
			.filter((goal: GoalConfig): boolean => goal.kind == 'foot' && this.joints.has(goal.effector))
			.map((goal: GoalConfig): number => this.joints.get(goal.effector) as number);

		let lowest: number = Infinity;
		for (const foot of foot_effectors) {
			lowest = Math.min(lowest, skeleton.bind_world[foot].position[1]);
			for (const child of skeleton.children[foot]) lowest = Math.min(lowest, skeleton.bind_world[child].position[1]);
		}
		if (!isFinite(lowest)) lowest = Math.min(...skeleton.bind_world.map((t): number => t.position[1]));
		this.ground_level = lowest;

		const pelvis_key: JointKey | undefined = config.solvers.find((s): boolean => s.kind == 'body')
			? (config.solvers.find((s): boolean => s.kind == 'body') as { pelvis: JointKey }).pelvis
			: undefined;
		const pelvis: number = pelvis_key !== undefined && this.joints.has(pelvis_key) ? (this.joints.get(pelvis_key) as number) : 0;
		const height: number = skeleton.bind_world[pelvis].position[1] - this.ground_level;
		this.body_scale = height > 1e-6 ? height : 1;

		this.forward = this.detectForward(foot_effectors, config.forward);
	}

	has(key: JointKey): boolean {
		return this.joints.has(key);
	}

	joint(key: JointKey): number {
		const index: number | undefined = this.joints.get(key);
		if (index === undefined) throw new Error(`IK rig: joint '${key}' is not bound`);
		return index;
	}

	/** Bound joints as a plain record */
	toRecord(): Record<JointKey, number> {
		return Object.fromEntries(this.joints);
	}

	/** Facing direction from foot -> toe offsets in the bind pose */
	private detectForward(foot_effectors: number[], fallback: Vec3): Vec3 {
		let sum: Vec3 = [0, 0, 0];
		for (const foot of foot_effectors) {
			const foot_position: Vec3 = this.skeleton.bind_world[foot].position;
			for (const child of this.skeleton.children[foot]) {
				const offset: Vec3 = this.skeleton.bind_world[child].position;
				sum = [sum[0] + offset[0] - foot_position[0], 0, sum[2] + offset[2] - foot_position[2]];
			}
		}
		if (length(sum) < 1e-6) return normalize([fallback[0], 0, fallback[2]]);
		return normalize(sum);
	}
}
