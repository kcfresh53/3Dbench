import type { Vec3, Quat } from '../core/math';
import type { Pose } from '../core/skeleton';
import type { RigBinding } from '../core/rig_binding';
import type { GoalSet } from '../core/goal_set';
import type { RuleConfig } from '../core/rig_types';

export interface GroundSample {
	/** World height of the surface */
	height: number;
	/** Unit surface normal */
	normal: Vec3;
}

export interface GroundProvider {
	/** Height the original animation was authored for (the flat floor the character walked on) */
	readonly reference_height: number;
	sample(x: number, z: number): GroundSample;
}

export class FlatGround implements GroundProvider {
	readonly reference_height: number;
	constructor(height: number = 0) {
		this.reference_height = height;
	}
	sample(): GroundSample {
		return { height: this.reference_height, normal: [0, 1, 0] };
	}
}

/** Terrain defined by a height function. Normals come from central differences. */
export class HeightFieldGround implements GroundProvider {
	readonly reference_height: number;
	private readonly height_at: (x: number, z: number) => number;
	private readonly step: number;
	constructor(height_at: (x: number, z: number) => number, reference_height: number = 0, step: number = 0.01) {
		this.height_at = height_at;
		this.reference_height = reference_height;
		this.step = step;
	}
	sample(x: number, z: number): GroundSample {
		const h: number = this.height_at(x, z);
		const dx: number = (this.height_at(x + this.step, z) - this.height_at(x - this.step, z)) / (2 * this.step);
		const dz: number = (this.height_at(x, z + this.step) - this.height_at(x, z - this.step)) / (2 * this.step);
		const length: number = Math.hypot(dx, 1, dz);
		return { height: h, normal: [-dx / length, 1 / length, -dz / length] };
	}
}

export interface ExternalTransform {
	position: Vec3;
	rotation: Quat;
}

export interface HandleState extends ExternalTransform {
	/** 0..1 how much the handle controls the goal at this time */
	weight: number;
	/** False when the handle only supplies a position */
	has_rotation: boolean;
}

/** One planted period of a foot, found by analysing the whole animation */
export interface ContactSegment {
	start: number;
	end: number;
	/** World position the foot is pinned to */
	pin: Vec3;
}

export interface ContactLock {
	weight: number;
	pin: Vec3;
}

export interface ContactTrack {
	/** Whether the animation travels far enough for world-space pinning to make sense */
	readonly has_root_motion: boolean;
	lockAt(goal_id: string, time: number, blend_time: number): ContactLock | null;
}

export interface RuleProviders {
	ground?: GroundProvider;
	handles?(goal_id: string): HandleState | null;
	attachments?(attachment_id: string): ExternalTransform | null;
	contacts?: ContactTrack | null;
}

export interface RuleContext {
	binding: RigBinding;
	/** The unmodified animated pose */
	fk: Pose;
	time: number;
	providers: RuleProviders;
}

/** A rule transforms the goals of the current frame before the solvers run. Rules never touch the pose. */
export interface GoalRule {
	readonly config: RuleConfig;
	apply(context: RuleContext, goals: GoalSet): void;
}
