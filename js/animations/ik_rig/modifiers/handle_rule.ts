import { lerp, quatSlerp } from '../core/math';
import type { GoalSet, Goal } from '../core/goal_set';
import type { HandleRuleConfig, GoalConfig } from '../core/rig_types';
import type { GoalRule, RuleContext, HandleState } from './rule_context';

/** Lets artists place goals with handles (null objects). Handles override the animation by their weight. */
export class HandleRule implements GoalRule {
	readonly config: HandleRuleConfig;
	constructor(config: HandleRuleConfig) {
		this.config = config;
	}

	apply(context: RuleContext, goals: GoalSet): void {
		const provider: ((goal_id: string) => HandleState | null) | undefined = context.providers.handles;
		if (!provider) return;
		for (const goal_config of context.binding.config.goals) {
			const goal: Goal | undefined = goals.get(goal_config.id);
			if (!goal) continue;
			const handle: HandleState | null = provider.call(context.providers, goal_config.id);
			if (!handle) {
				// goals that only exist as handles stay inactive until one is available
				if (goal_config.mode == 'handle') goal.active = false;
				continue;
			}
			const weight: number = Math.min(1, Math.max(0, handle.weight * this.config.weight));
			goal.position = lerp(goal.position, handle.position, weight);
			if (handle.has_rotation) goal.rotation = quatSlerp(goal.rotation, handle.rotation, weight);
			goal.active = true;
			this.markManual(goal_config, goal);
		}
	}

	/** A manually placed foot is not planted by the ground rules */
	private markManual(goal_config: GoalConfig, goal: Goal): void {
		if (goal_config.kind == 'foot') goal.contact = 0;
	}
}
