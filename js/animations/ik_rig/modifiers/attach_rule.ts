import { Vec3, add, lerp, quatRotate, quatSlerp } from '../core/math';
import type { GoalSet, Goal } from '../core/goal_set';
import type { AttachRuleConfig } from '../core/rig_types';
import type { GoalRule, RuleContext, ExternalTransform } from './rule_context';

/** Holds a goal on a moving attachment point, for example both hands on a weapon */
export class AttachRule implements GoalRule {
	readonly config: AttachRuleConfig;
	constructor(config: AttachRuleConfig) {
		this.config = config;
	}

	apply(context: RuleContext, goals: GoalSet): void {
		const goal: Goal | undefined = goals.get(this.config.goal);
		if (!goal || !goal.active || !context.providers.attachments) return;
		const attachment: ExternalTransform | null = context.providers.attachments(this.config.attachment);
		if (!attachment) return;
		const weight: number = this.config.weight;
		if (this.config.position) {
			const target: Vec3 = add(attachment.position, quatRotate(attachment.rotation, this.config.offset));
			goal.position = lerp(goal.position, target, weight);
		}
		if (this.config.rotation) goal.rotation = quatSlerp(goal.rotation, attachment.rotation, weight);
	}
}
