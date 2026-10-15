import { Vec3, lerp } from '../core/math';
import type { GoalSet, Goal } from '../core/goal_set';
import type { FootLockRuleConfig } from '../core/rig_types';
import type { GoalRule, RuleContext, ContactLock } from './rule_context';

/** Pins planted feet to the world position found by the contact analysis, which removes foot sliding. */
export class FootLockRule implements GoalRule {
	readonly config: FootLockRuleConfig;
	constructor(config: FootLockRuleConfig) {
		this.config = config;
	}

	apply(context: RuleContext, goals: GoalSet): void {
		const contacts = context.providers.contacts;
		if (!contacts) return;
		if (this.config.require_root_motion && !contacts.has_root_motion) return;
		for (const id of this.config.goals) {
			const goal: Goal | undefined = goals.get(id);
			if (!goal || !goal.active) continue;
			const lock: ContactLock | null = contacts.lockAt(id, context.time, this.config.blend_time);
			if (!lock) continue;
			const weight: number = lock.weight * this.config.weight;
			// only the horizontal position is pinned, the ground rule owns the height
			const pinned: Vec3 = lerp(goal.position, lock.pin, weight);
			goal.position = [pinned[0], goal.position[1], pinned[2]];
			goal.contact = Math.max(goal.contact, lock.weight);
		}
	}
}
