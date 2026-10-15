import {
	Vec3, Quat, add, sub, scale, dot, length, normalize, lerp, projectOnPlane, cross, clamp,
	quatFromTo, quatMul, quatConjugate, quatRotate, quatSlerp,
} from '../core/math';
import type { Goal } from '../core/goal_set';
import type { LimbSolverConfig } from '../core/rig_types';
import type { IKSolver, SolveContext } from './ik_solver';

/**
 * Analytic two bone solver (law of cosines). Supports soft reach, a pole taken from the animation
 * (so knees and elbows keep pointing the way the animator posed them) and interior angle limits.
 */
export class LimbSolver implements IKSolver {
	readonly config: LimbSolverConfig;
	constructor(config: LimbSolverConfig) {
		this.config = config;
	}

	solve(context: SolveContext): void {
		const goal: Goal | undefined = context.goals.get(this.config.goal);
		if (!goal || !goal.active) return;
		const binding = context.binding;
		const pose = context.pose;
		const root: number = binding.joint(this.config.root);
		const mid: number = binding.joint(this.config.mid);
		const end: number = binding.joint(this.config.end);

		const position_weight: number = clamp(goal.position_weight * this.config.weight, 0, 1);
		if (position_weight > 0) this.solvePosition(context, goal, root, mid, end, position_weight);

		const rotation_weight: number = clamp(goal.rotation_weight * this.config.weight, 0, 1);
		if (rotation_weight > 0) {
			pose.setWorldRotation(end, quatSlerp(pose.worldRotation(end), goal.rotation, rotation_weight));
		}
	}

	private solvePosition(context: SolveContext, goal: Goal, root: number, mid: number, end: number, weight: number): void {
		const pose = context.pose;
		const a: Vec3 = pose.worldPosition(root);
		const b: Vec3 = pose.worldPosition(mid);
		const c: Vec3 = pose.worldPosition(end);
		const l1: number = length(sub(b, a));
		const l2: number = length(sub(c, b));
		if (l1 < 1e-9 || l2 < 1e-9) return;

		const target: Vec3 = lerp(c, goal.position, weight);
		const to_target: Vec3 = sub(target, a);
		const raw_distance: number = length(to_target);
		if (raw_distance < 1e-9) return;
		const axis: Vec3 = scale(to_target, 1 / raw_distance);

		// reach range from the interior angle limits
		const reach_at = (interior_deg: number): number =>
			Math.sqrt(Math.max(0, l1 * l1 + l2 * l2 - 2 * l1 * l2 * Math.cos((interior_deg * Math.PI) / 180)));
		const max_reach: number = Math.min(l1 + l2, reach_at(this.config.max_interior_deg)) * 0.99999;
		const min_reach: number = Math.max(Math.abs(l1 - l2) * 1.00001 + 1e-6, reach_at(this.config.min_interior_deg));
		let reach: number = raw_distance;
		const soft_length: number = this.config.softness * 0.25 * (l1 + l2);
		if (soft_length > 1e-9) {
			const soft_start: number = max_reach - soft_length;
			if (reach > soft_start) reach = soft_start + soft_length * (1 - Math.exp(-(reach - soft_start) / soft_length));
		}
		reach = clamp(reach, min_reach, Math.max(min_reach, max_reach));

		const bend: Vec3 = this.bendDirection(context, goal, root, a, b, c, axis);

		const cos_a: number = clamp((l1 * l1 + reach * reach - l2 * l2) / (2 * l1 * reach), -1, 1);
		const sin_a: number = Math.sqrt(1 - cos_a * cos_a);
		const new_mid: Vec3 = add(a, add(scale(axis, l1 * cos_a), scale(bend, l1 * sin_a)));
		const new_end: Vec3 = add(a, scale(axis, reach));

		pose.rotateWorld(root, quatFromTo(sub(b, a), sub(new_mid, a)));
		const mid_now: Vec3 = pose.worldPosition(mid);
		const end_now: Vec3 = pose.worldPosition(end);
		pose.rotateWorld(mid, quatFromTo(sub(end_now, mid_now), sub(new_end, mid_now)));
	}

	/** Unit vector perpendicular to `axis` pointing from the limb axis towards the bend joint */
	private bendDirection(context: SolveContext, goal: Goal, root: number, a: Vec3, b: Vec3, c: Vec3, axis: Vec3): Vec3 {
		const current_axis: Vec3 = normalize(sub(c, a));
		const current: Vec3 = projectOnPlane(sub(b, a), current_axis);
		let desired: Vec3 = current;
		if (goal.pole_direction && goal.pole_weight > 0) {
			// the pole turns with whatever carries the limb (pelvis, chest) so it follows body rotation
			const carried: Quat = quatMul(context.pose.parentWorldRotation(root), quatConjugate(context.fk.parentWorldRotation(root)));
			const pole: Vec3 = quatRotate(carried, goal.pole_direction);
			desired = length(current) > 1e-9 ? lerp(normalize(current), pole, clamp(goal.pole_weight, 0, 1)) : pole;
		}
		let direction: Vec3 = projectOnPlane(desired, axis);
		if (length(direction) < 1e-6) direction = projectOnPlane(current, axis);
		if (length(direction) < 1e-6) {
			// perfectly straight limb without a pole: pick any stable perpendicular
			direction = cross(axis, Math.abs(dot(axis, [1, 0, 0])) < 0.9 ? [1, 0, 0] : [0, 0, 1]);
		}
		return normalize(direction);
	}
}
