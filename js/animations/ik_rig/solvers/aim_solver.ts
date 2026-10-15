import { Vec3, Quat, sub, length, normalize, clamp, quatFromTo, quatRotate, quatConjugate, quatScaleAngle, quatAngle } from '../core/math';
import type { Goal } from '../core/goal_set';
import type { AimSolverConfig } from '../core/rig_types';
import type { IKSolver, SolveContext } from './ik_solver';

/** Rotates a chain (neck + head, spine + head, ...) so the last joint's aim axis points at the goal */
export class AimSolver implements IKSolver {
	readonly config: AimSolverConfig;
	constructor(config: AimSolverConfig) {
		this.config = config;
	}

	solve(context: SolveContext): void {
		const goal: Goal | undefined = context.goals.get(this.config.goal);
		if (!goal || !goal.active || !this.config.joints.length) return;
		const weight: number = clamp(goal.position_weight * this.config.weight, 0, 1);
		if (weight <= 0) return;
		const binding = context.binding;
		const pose = context.pose;
		const joints: number[] = this.config.joints.map((key: string): number => binding.joint(key));
		const last: number = joints[joints.length - 1];

		const rest_axis: Vec3 = normalize(this.config.aim_axis ?? binding.forward);
		const local_axis: Vec3 = quatRotate(quatConjugate(binding.skeleton.bind_world[last].rotation), rest_axis);
		const current: Vec3 = quatRotate(pose.worldRotation(last), local_axis);
		const to_goal: Vec3 = sub(goal.position, pose.worldPosition(last));
		if (length(to_goal) < 1e-9) return;

		let total: Quat = quatFromTo(current, normalize(to_goal));
		const max: number = (this.config.max_angle_deg * Math.PI) / 180;
		const angle: number = quatAngle(total);
		if (angle > max && angle > 1e-9) total = quatScaleAngle(total, max / angle);

		const shares: number[] = joints.map((_: number, i: number): number => this.config.distribution[i] ?? 1);
		const share_sum: number = shares.reduce((a: number, b: number): number => a + b, 0);
		if (share_sum <= 0) return;
		joints.forEach((joint: number, i: number): void => {
			pose.rotateWorld(joint, quatScaleAngle(total, (weight * shares[i]) / share_sum));
		});
	}
}
