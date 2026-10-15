import { Vec3, add, sub, scale, length, normalize, lerp, clamp, quatFromTo, quatSlerp, quatAngle, quatMul, quatConjugate } from '../core/math';
import type { Goal } from '../core/goal_set';
import type { ChainSolverConfig } from '../core/rig_types';
import type { IKSolver, SolveContext } from './ik_solver';

/** FABRIK on joint positions of any chain; rotations are rebuilt afterwards with shortest arcs */
export class ChainSolver implements IKSolver {
	readonly config: ChainSolverConfig;
	constructor(config: ChainSolverConfig) {
		this.config = config;
	}

	solve(context: SolveContext): void {
		const goal: Goal | undefined = context.goals.get(this.config.goal);
		if (!goal || !goal.active || this.config.joints.length < 2) return;
		const weight: number = clamp(goal.position_weight * this.config.weight, 0, 1);
		if (weight <= 0) return;
		const pose = context.pose;
		const joints: number[] = this.config.joints.map((key: string): number => context.binding.joint(key));
		const tip: number = joints[joints.length - 1];
		const target: Vec3 = lerp(pose.worldPosition(tip), goal.position, weight);
		const solved: Vec3[] = fabrik(joints.map((j: number): Vec3 => pose.worldPosition(j)), target, this.config.iterations, this.config.tolerance);

		const original_local = joints.map((j: number) => pose.local[j].rotation);
		for (let i: number = 0; i < joints.length - 1; i++) {
			const current: Vec3 = sub(pose.worldPosition(joints[i + 1]), pose.worldPosition(joints[i]));
			const desired: Vec3 = sub(solved[i + 1], solved[i]);
			pose.rotateWorld(joints[i], quatFromTo(current, desired));
			if (this.config.max_bend_deg > 0) {
				// keep each joint within a bounded deviation from the animated rotation
				const relative = quatMul(quatConjugate(original_local[i]), pose.local[joints[i]].rotation);
				const limit: number = (this.config.max_bend_deg * Math.PI) / 180;
				const angle: number = quatAngle(relative);
				if (angle > limit) pose.setLocalRotation(joints[i], quatSlerp(original_local[i], pose.local[joints[i]].rotation, limit / angle));
			}
		}
	}
}

/** Positions-only FABRIK. The first point stays fixed; unreachable targets stretch the chain straight towards them. */
export function fabrik(points: Vec3[], target: Vec3, max_iterations: number, tolerance: number): Vec3[] {
	const n: number = points.length;
	const result: Vec3[] = points.map((p: Vec3): Vec3 => [p[0], p[1], p[2]]);
	const lengths: number[] = [];
	for (let i: number = 0; i < n - 1; i++) lengths.push(length(sub(points[i + 1], points[i])));
	const total: number = lengths.reduce((a: number, b: number): number => a + b, 0);
	const root: Vec3 = points[0];

	if (length(sub(target, root)) >= total) {
		const direction: Vec3 = normalize(sub(target, root));
		for (let i: number = 1; i < n; i++) result[i] = add(result[i - 1], scale(direction, lengths[i - 1]));
		return result;
	}
	for (let iteration: number = 0; iteration < max_iterations; iteration++) {
		if (length(sub(result[n - 1], target)) <= tolerance) break;
		result[n - 1] = [target[0], target[1], target[2]];
		for (let i: number = n - 2; i >= 0; i--) {
			result[i] = add(result[i + 1], scale(normalize(sub(result[i], result[i + 1])), lengths[i]));
		}
		result[0] = [root[0], root[1], root[2]];
		for (let i: number = 1; i < n; i++) {
			result[i] = add(result[i - 1], scale(normalize(sub(result[i], result[i - 1])), lengths[i - 1]));
		}
	}
	return result;
}
