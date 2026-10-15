import { Vec3, Quat, sub, normalize, length, projectOnPlane } from './math';
import { Pose } from './skeleton';
import type { RigBinding } from './rig_binding';
import { Goal, GoalSet } from './goal_set';
import type { GoalConfig, LimbSolverConfig, SolverConfig } from './rig_types';
import type { GoalRule, RuleProviders } from '../modifiers/rule_context';
import { createRule } from '../modifiers/create_rule';
import type { IKSolver } from '../solvers/ik_solver';
import { createSolver } from '../solvers/create_solver';

/** Replaces parts of an extracted goal, used by the retargeter to feed in goals from another skeleton */
export interface GoalOverride {
	position?: Vec3;
	rotation?: Quat;
	pole_direction?: Vec3 | null;
}

export interface EvaluateOptions {
	/** Animation time in seconds, used by time dependent rules */
	time: number;
	providers?: RuleProviders;
	overrides?: Map<string, GoalOverride>;
}

export interface EvaluateResult {
	pose: Pose;
	goals: GoalSet;
}

/**
 * Runtime of an IK rig:
 *   animated pose -> goals -> rules (procedural changes) -> solver stack -> final pose.
 * The class is stateless between calls, so evaluating frames in any order gives the same result.
 */
export class IKRig {
	readonly binding: RigBinding;
	private rules: GoalRule[] = [];
	private solvers: IKSolver[] = [];

	constructor(binding: RigBinding) {
		this.binding = binding;
		this.rebuild();
	}

	/** Recreates rules and solvers, call after the config object was edited */
	rebuild(): void {
		this.rules = this.binding.config.rules.map(createRule);
		this.solvers = this.binding.config.solvers.map(createSolver);
	}

	extractGoals(fk: Pose): GoalSet {
		const goals: GoalSet = new GoalSet();
		for (const config of this.binding.config.goals) {
			if (!this.binding.has(config.effector)) continue;
			const effector: number = this.binding.joint(config.effector);
			const position: Vec3 = [...fk.worldPosition(effector)] as Vec3;
			const rotation: Quat = [...fk.worldRotation(effector)] as Quat;
			const goal: Goal = {
				id: config.id,
				effector,
				active: config.mode == 'follow',
				position,
				rotation,
				position_weight: config.position_weight,
				rotation_weight: config.rotation_weight,
				pole_direction: this.poleDirection(config, fk, effector),
				pole_weight: config.pole_weight,
				fk_position: [...position] as Vec3,
				fk_rotation: [...rotation] as Quat,
				contact: 0,
			};
			goals.add(goal);
		}
		return goals;
	}

	evaluate(fk: Pose, options: EvaluateOptions): EvaluateResult {
		const goals: GoalSet = this.extractGoals(fk);
		if (options.overrides) {
			for (const [id, override] of options.overrides) {
				const goal: Goal | undefined = goals.get(id);
				if (!goal) continue;
				if (override.position) goal.position = override.position;
				if (override.rotation) goal.rotation = override.rotation;
				if (override.pole_direction !== undefined) goal.pole_direction = override.pole_direction;
			}
		}

		const context = { binding: this.binding, fk, time: options.time, providers: options.providers ?? {} };
		for (const rule of this.rules) {
			if (rule.config.enabled && rule.config.weight > 0) rule.apply(context, goals);
		}

		const pose: Pose = fk.clone();
		for (const solver of this.solvers) {
			if (solver.config.enabled && solver.config.weight > 0) solver.solve({ binding: this.binding, pose, fk, goals });
		}
		return { pose, goals };
	}

	/** Bend direction (from the limb axis towards the pole joint) as animated */
	private poleDirection(config: GoalConfig, fk: Pose, effector: number): Vec3 | null {
		if (!config.pole_joint || !this.binding.has(config.pole_joint)) return null;
		const mid: number = this.binding.joint(config.pole_joint);
		const limb: LimbSolverConfig | undefined = this.binding.config.solvers.find(
			(solver: SolverConfig): boolean => solver.kind == 'limb' && solver.goal == config.id,
		) as LimbSolverConfig | undefined;
		const root: number = limb && this.binding.has(limb.root) ? this.binding.joint(limb.root) : this.binding.skeleton.parents[mid];
		if (root < 0) return null;
		const axis: Vec3 = normalize(sub(fk.worldPosition(effector), fk.worldPosition(root)));
		const bend: Vec3 = projectOnPlane(sub(fk.worldPosition(mid), fk.worldPosition(root)), axis);
		return length(bend) > 1e-5 ? normalize(bend) : null;
	}
}
