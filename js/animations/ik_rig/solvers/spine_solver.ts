import { Quat, quatMul, quatConjugate, quatScaleAngle, clamp, cross, quatFromAxisAngle } from '../core/math';
import { bodyForward } from '../modifiers/offset_rules';
import type { Goal } from '../core/goal_set';
import type { SpineSolverConfig } from '../core/rig_types';
import type { IKSolver, SolveContext } from './ik_solver';

/**
 * Keeps the upper body orientation of the animation while the pelvis moves: the difference between the
 * chest's current and goal rotation is spread over the spine joints.
 */
export class SpineSolver implements IKSolver {
	readonly config: SpineSolverConfig;
	constructor(config: SpineSolverConfig) {
		this.config = config;
	}

	solve(context: SolveContext): void {
		const goal: Goal | undefined = context.goals.get(this.config.goal);
		if (!goal || !goal.active || !this.config.joints.length) return;
		const weight: number = clamp(goal.rotation_weight * this.config.weight, 0, 1);
		if (weight <= 0) return;
		const pose = context.pose;
		const joints: number[] = this.config.joints.map((key: string): number => context.binding.joint(key));
		const tip: number = joints[joints.length - 1];
		const forward = bodyForward({ binding: context.binding, fk: context.fk, time: 0, providers: {} });
		const right = cross([0, 1, 0], forward);
		const pitch = quatFromAxisAngle(right, clamp(this.config.lean_forward_deg ?? 0, -60, 60) * Math.PI / 180);
		const roll = quatFromAxisAngle(forward, -clamp(this.config.lean_side_deg ?? 0, -60, 60) * Math.PI / 180);
		const target: Quat = quatMul(quatMul(roll, pitch), goal.rotation);
		const delta: Quat = quatMul(target, quatConjugate(pose.worldRotation(tip)));

		const shares: number[] = joints.map((_: number, i: number): number => this.config.distribution[i] ?? 1);
		const total: number = shares.reduce((a: number, b: number): number => a + b, 0);
		if (total <= 0) return;
		joints.forEach((joint: number, i: number): void => {
			pose.rotateWorld(joint, quatScaleAngle(delta, (weight * shares[i]) / total));
		});
	}
}
