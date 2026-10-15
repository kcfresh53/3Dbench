import type { Vec3, Quat } from './math';

/** A live goal: where an effector should be this frame */
export interface Goal {
	readonly id: string;
	readonly effector: number;
	/** False when a goal in handle mode has no handle yet. Inactive goals are ignored by the solvers. */
	active: boolean;
	position: Vec3;
	rotation: Quat;
	position_weight: number;
	rotation_weight: number;
	/** Unit direction (world) from the limb axis towards the bend joint, taken from the animation */
	pole_direction: Vec3 | null;
	pole_weight: number;
	/** Effector transform of the unmodified animation */
	readonly fk_position: Vec3;
	readonly fk_rotation: Quat;
	/** 0..1 how planted the effector is on the ground (written by the ground and foot lock rules) */
	contact: number;
}

export class GoalSet {
	private readonly goals: Map<string, Goal> = new Map();

	add(goal: Goal): void {
		this.goals.set(goal.id, goal);
	}

	get(id: string): Goal | undefined {
		return this.goals.get(id);
	}

	has(id: string): boolean {
		return this.goals.has(id);
	}

	all(): Goal[] {
		return [...this.goals.values()];
	}
}
