import { Vec3, add, scale, cross, normalize, quatRotate, quatMul, quatConjugate } from '../core/math';
import type { GoalSet, Goal } from '../core/goal_set';
import type { OffsetRuleConfig, OscillateRuleConfig } from '../core/rig_types';
import type { GoalRule, RuleContext } from './rule_context';

/** Direction the pelvis of the animated pose faces, flattened to the ground plane */
export function bodyForward(context: RuleContext): Vec3 {
	const body = context.binding.config.solvers.find((s): boolean => s.kind == 'body') as { pelvis: string } | undefined;
	if (!body || !context.binding.has(body.pelvis)) return context.binding.forward;
	const joint: number = context.binding.joint(body.pelvis);
	const delta = quatMul(context.fk.worldRotation(joint), quatConjugate(context.binding.skeleton.bind_world[joint].rotation));
	const rotated: Vec3 = quatRotate(delta, context.binding.forward);
	const horizontal: Vec3 = [rotated[0], 0, rotated[2]];
	return Math.hypot(...horizontal) > 1e-6 ? normalize(horizontal) : context.binding.forward;
}

export class OffsetRule implements GoalRule {
	readonly config: OffsetRuleConfig;
	constructor(config: OffsetRuleConfig) {
		this.config = config;
	}

	apply(context: RuleContext, goals: GoalSet): void {
		const goal: Goal | undefined = goals.get(this.config.goal);
		if (!goal || !goal.active) return;
		const o: Vec3 = this.config.offset;
		let world: Vec3 = o;
		if (this.config.space == 'body') {
			const forward: Vec3 = bodyForward(context);
			const lateral: Vec3 = cross([0, 1, 0], forward);
			world = add(add(scale(lateral, o[0]), [0, o[1], 0]), scale(forward, o[2]));
		} else if (this.config.space == 'goal') {
			world = quatRotate(goal.rotation, o);
		}
		goal.position = add(goal.position, scale(world, this.config.weight));
	}
}

export class OscillateRule implements GoalRule {
	readonly config: OscillateRuleConfig;
	constructor(config: OscillateRuleConfig) {
		this.config = config;
	}

	apply(context: RuleContext, goals: GoalSet): void {
		const goal: Goal | undefined = goals.get(this.config.goal);
		if (!goal || !goal.active) return;
		const wave: number = Math.sin(2 * Math.PI * (this.config.frequency * context.time + this.config.phase));
		goal.position = add(goal.position, scale(this.config.amplitude, wave * this.config.weight));
	}
}
