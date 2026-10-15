import { Vec3, Quat, add, sub, scale, length, normalize, quatFromTo, quatScaleAngle, quatAngle, clamp, quatSlerp } from '../core/math';
import type { Goal } from '../core/goal_set';
import type { BodySolverConfig, LimbSolverConfig, SolverConfig } from '../core/rig_types';
import type { IKSolver, SolveContext } from './ik_solver';

interface LegInfo {
	goal: Goal;
	hip: number;
	end: number;
}

/**
 * The "body" part of the rig: the pelvis follows the goals of the legs so they can reach them
 * (lowering the body when a foot steps down, tilting it when the feet are at different heights)
 * and leans slightly towards hand goals. Everything above the pelvis is corrected by the spine solver.
 */
export class BodySolver implements IKSolver {
	readonly config: BodySolverConfig;
	constructor(config: BodySolverConfig) {
		this.config = config;
	}

	solve(context: SolveContext): void {
		const cfg: BodySolverConfig = this.config;
		const pose = context.pose;
		const pelvis: number = context.binding.joint(cfg.pelvis);
		const legs: LegInfo[] = this.collectLegs(context);
		if (!legs.length || cfg.weight <= 0) return;

		const original_rotation: Quat = [...pose.worldRotation(pelvis)];
		const influence: number = clamp(cfg.weight, 0, 1);

		// 1. tilt the pelvis with the height difference of the two feet
		if (legs.length >= 2 && cfg.tilt_weight > 0) {
			const hips: Vec3 = sub(pose.worldPosition(legs[1].hip), pose.worldPosition(legs[0].hip));
			const lift_a: number = (legs[0].goal.position[1] - pose.worldPosition(legs[0].end)[1]) * clamp(legs[0].goal.position_weight, 0, 1);
			const lift_b: number = (legs[1].goal.position[1] - pose.worldPosition(legs[1].end)[1]) * clamp(legs[1].goal.position_weight, 0, 1);
			const tilted: Vec3 = add(hips, [0, (lift_b - lift_a) * cfg.tilt_weight, 0]);
			let tilt: Quat = quatFromTo(hips, tilted);
			const max: number = (cfg.max_tilt_deg * Math.PI) / 180;
			const angle: number = quatAngle(tilt);
			if (angle > max) tilt = quatScaleAngle(tilt, max / angle);
			pose.rotateWorld(pelvis, tilt);
		}

		// 2. desired translation: average offset of the leg goals
		let weight_sum: number = 0;
		let offset: Vec3 = [0, 0, 0];
		for (const leg of legs) {
			const w: number = leg.goal.position_weight;
			offset = add(offset, scale(sub(leg.goal.position, pose.worldPosition(leg.end)), w));
			weight_sum += w;
		}
		if (weight_sum <= 0) return;
		offset = scale(offset, 1 / weight_sum);
		let translation: Vec3 = [offset[0] * cfg.horizontal_weight, offset[1] * cfg.vertical_weight, offset[2] * cfg.horizontal_weight];

		// hands pull the body a bit
		if (cfg.hand_pull > 0) {
			const pulls: Vec3[] = cfg.hand_goals
				.map((id: string): Goal | undefined => context.goals.get(id))
				.filter((goal: Goal | undefined): goal is Goal => !!goal && goal.active)
				.map((goal: Goal): Vec3 => scale(sub(goal.position, goal.fk_position), clamp(goal.position_weight, 0, 1)));
			if (pulls.length) {
				const mean: Vec3 = scale(pulls.reduce((a: Vec3, b: Vec3): Vec3 => add(a, b), [0, 0, 0]), 1 / pulls.length);
				translation = add(translation, scale(mean, cfg.hand_pull));
			}
		}
		translation[1] -= clamp(cfg.crouch ?? 0, 0, 0.65) * context.binding.body_scale;

		// 3. never let a leg get over-extended: move the pelvis towards any goal that is out of reach
		for (let pass: number = 0; pass < 4; pass++) {
			let changed: boolean = false;
			for (const leg of legs) {
				// never demand more than the animation itself had, so untouched poses stay untouched
				const animated: number = length(sub(context.fk.worldPosition(leg.hip), context.fk.worldPosition(leg.end)));
				const reach: number = Math.max(this.legLength(context, leg) * cfg.max_extension, animated);
				const hip: Vec3 = add(pose.worldPosition(leg.hip), translation);
				const to_goal: Vec3 = sub(leg.goal.position, hip);
				const distance: number = length(to_goal);
				if (distance > reach && leg.goal.position_weight > 0) {
					translation = add(translation, scale(normalize(to_goal), (distance - reach) * clamp(leg.goal.position_weight, 0, 1)));
					changed = true;
				}
			}
			if (!changed) break;
		}
		// Blend the complete solution, including reach correction, so small weights stay small.
		pose.setWorldRotation(pelvis, quatSlerp(original_rotation, pose.worldRotation(pelvis), influence));
		pose.translateWorld(pelvis, scale(translation, influence));
	}

	private legLength(context: SolveContext, leg: LegInfo): number {
		const limb: LimbSolverConfig | undefined = this.findLimb(context, leg.goal.id);
		if (!limb) return Infinity;
		const pose = context.pose;
		const root: number = context.binding.joint(limb.root);
		const mid: number = context.binding.joint(limb.mid);
		return length(sub(pose.worldPosition(mid), pose.worldPosition(root))) + length(sub(pose.worldPosition(leg.end), pose.worldPosition(mid)));
	}

	private findLimb(context: SolveContext, goal_id: string): LimbSolverConfig | undefined {
		return context.binding.config.solvers.find(
			(solver: SolverConfig): boolean => solver.kind == 'limb' && solver.goal == goal_id,
		) as LimbSolverConfig | undefined;
	}

	private collectLegs(context: SolveContext): LegInfo[] {
		const legs: LegInfo[] = [];
		for (const id of this.config.leg_goals) {
			const goal: Goal | undefined = context.goals.get(id);
			const limb: LimbSolverConfig | undefined = this.findLimb(context, id);
			if (!goal || !goal.active || goal.position_weight <= 0 || !limb || !limb.enabled || limb.weight <= 0) continue;
			legs.push({ goal, hip: context.binding.joint(limb.root), end: goal.effector });
		}
		return legs;
	}
}
