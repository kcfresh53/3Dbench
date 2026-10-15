import type { Pose } from '../core/skeleton';
import type { RigBinding } from '../core/rig_binding';
import type { GoalSet } from '../core/goal_set';
import type { SolverConfig } from '../core/rig_types';

export interface SolveContext {
	binding: RigBinding;
	/** The pose being modified. It starts as the animated pose and every solver refines it. */
	pose: Pose;
	/** The unmodified animated pose */
	fk: Pose;
	goals: GoalSet;
}

export interface IKSolver {
	readonly config: SolverConfig;
	solve(context: SolveContext): void;
}
