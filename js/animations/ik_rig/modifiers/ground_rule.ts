import { Vec3, Quat, lerp, smoothstep, quatFromTo, quatSlerp, quatMul, QUAT_IDENTITY } from '../core/math';
import type { GoalSet, Goal } from '../core/goal_set';
import type { GroundRuleConfig } from '../core/rig_types';
import type { GoalRule, RuleContext, GroundProvider, GroundSample } from './rule_context';
import { FlatGround } from './rule_context';

/**
 * Terrain adaption for feet. Planted feet move onto the ground surface and align to its slope, lifted feet follow
 * the terrain only partly but never sink into it. The pelvis is lowered by the body solver afterwards.
 */
export class GroundRule implements GoalRule {
	readonly config: GroundRuleConfig;
	constructor(config: GroundRuleConfig) {
		this.config = config;
	}

	apply(context: RuleContext, goals: GoalSet): void {
		const ground: GroundProvider = context.providers.ground ?? new FlatGround(0);
		const binding = context.binding;
		const weight: number = this.config.weight;
		for (const id of this.config.goals) {
			const goal: Goal | undefined = goals.get(id);
			if (!goal || !goal.active) continue;

			// height of the effector above the sole in the bind pose
			const rest_height: number = binding.skeleton.bind_world[goal.effector].position[1] - binding.ground_level;
			const clearance: number = goal.fk_position[1] - ground.reference_height - rest_height;
			const contact: number = 1 - smoothstep(clearance / Math.max(1e-6, this.config.lift_threshold * binding.body_scale));

			const surface: GroundSample = ground.sample(goal.position[0], goal.position[2]);
			const raise: number = surface.height - ground.reference_height;
			const follow: number = this.config.swing_follow + (1 - this.config.swing_follow) * contact;
			const target_y: number = Math.max(goal.position[1] + raise * follow, surface.height + rest_height);

			const target: Vec3 = [goal.position[0], target_y, goal.position[2]];
			goal.position = lerp(goal.position, target, weight);

			const slope: Quat = quatFromTo([0, 1, 0], surface.normal);
			const aligned: Quat = quatSlerp(QUAT_IDENTITY as Quat, slope, contact * this.config.slope_weight * weight);
			goal.rotation = quatMul(aligned, goal.rotation);
			goal.contact = Math.max(goal.contact, contact);
		}
	}
}
