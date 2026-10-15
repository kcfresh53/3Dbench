import { Vec3, distance, smoothstep } from '../core/math';
import type { Pose } from '../core/skeleton';
import type { RigBinding } from '../core/rig_binding';
import type { FootLockRuleConfig, GoalConfig } from '../core/rig_types';
import type { ContactSegment, ContactTrack, ContactLock } from './rule_context';

export interface ContactAnalysisOptions {
	/** Sampled FK pose at a time */
	sample: (time: number) => Pose;
	duration: number;
	/** Samples per second */
	fps: number;
}

/**
 * Pre-computed foot contacts of one animation. The analysis looks at the whole animation once so that
 * lookups afterwards are stateless and scrubbing / baking give identical results.
 */
export class AnalysedContacts implements ContactTrack {
	readonly has_root_motion: boolean;
	private readonly segments: Map<string, ContactSegment[]>;

	constructor(segments: Map<string, ContactSegment[]>, has_root_motion: boolean) {
		this.segments = segments;
		this.has_root_motion = has_root_motion;
	}

	segmentsOf(goal_id: string): ContactSegment[] {
		return this.segments.get(goal_id) ?? [];
	}

	lockAt(goal_id: string, time: number, blend_time: number): ContactLock | null {
		const list: ContactSegment[] | undefined = this.segments.get(goal_id);
		if (!list) return null;
		for (const segment of list) {
			if (time < segment.start || time > segment.end) continue;
			const blend: number = Math.max(1e-4, Math.min(blend_time, (segment.end - segment.start) / 2));
			const weight: number = Math.min(smoothstep((time - segment.start) / blend), smoothstep((segment.end - time) / blend));
			return { weight, pin: segment.pin };
		}
		return null;
	}
}

export function analyseContacts(binding: RigBinding, rule: FootLockRuleConfig, options: ContactAnalysisOptions): AnalysedContacts {
	const frame_count: number = Math.max(2, Math.round(options.duration * options.fps) + 1);
	const dt: number = 1 / options.fps;
	const scale: number = binding.body_scale;
	const poses: Pose[] = [];
	for (let k: number = 0; k < frame_count; k++) poses.push(options.sample(Math.min(options.duration, k * dt)));

	// travel of the pelvis decides whether pinning in world space is meaningful
	const pelvis_joint: number = pelvisJoint(binding);
	const first: Vec3 = poses[0].worldPosition(pelvis_joint);
	let travel: number = 0;
	for (const pose of poses) {
		const p: Vec3 = pose.worldPosition(pelvis_joint);
		travel = Math.max(travel, Math.hypot(p[0] - first[0], p[2] - first[2]));
	}
	const has_root_motion: boolean = travel > 0.25 * scale;

	const segments: Map<string, ContactSegment[]> = new Map();
	for (const id of rule.goals) {
		const goal: GoalConfig | undefined = binding.config.goals.find((g: GoalConfig): boolean => g.id == id);
		if (!goal || !binding.has(goal.effector)) continue;
		const joint: number = binding.joint(goal.effector);
		const rest_y: number = binding.skeleton.bind_world[joint].position[1];
		const planted: boolean[] = poses.map((pose: Pose, k: number): boolean => {
			const position: Vec3 = pose.worldPosition(joint);
			const before: Vec3 = poses[Math.max(0, k - 1)].worldPosition(joint);
			const after: Vec3 = poses[Math.min(frame_count - 1, k + 1)].worldPosition(joint);
			const span: number = (Math.min(frame_count - 1, k + 1) - Math.max(0, k - 1)) * dt;
			const speed: number = distance(before, after) / span;
			const clearance: number = position[1] - rest_y;
			return clearance < rule.lift_threshold * scale && speed < rule.speed_threshold * scale;
		});
		closeShortGaps(planted, 2);
		segments.set(id, extractSegments(planted, poses, joint, dt, 3));
	}
	return new AnalysedContacts(segments, has_root_motion);
}

function pelvisJoint(binding: RigBinding): number {
	const body = binding.config.solvers.find((s): boolean => s.kind == 'body') as { pelvis: string } | undefined;
	return body && binding.has(body.pelvis) ? binding.joint(body.pelvis) : 0;
}

/** Fills planted=false gaps up to `max_gap` frames long that sit between planted frames */
function closeShortGaps(planted: boolean[], max_gap: number): void {
	let k: number = 0;
	while (k < planted.length) {
		if (planted[k]) { k++; continue; }
		let end: number = k;
		while (end < planted.length && !planted[end]) end++;
		if (k > 0 && end < planted.length && end - k <= max_gap) for (let i: number = k; i < end; i++) planted[i] = true;
		k = end;
	}
}

function extractSegments(planted: boolean[], poses: Pose[], joint: number, dt: number, min_frames: number): ContactSegment[] {
	const result: ContactSegment[] = [];
	let k: number = 0;
	while (k < planted.length) {
		if (!planted[k]) { k++; continue; }
		let end: number = k;
		while (end < planted.length && planted[end]) end++;
		if (end - k >= min_frames) {
			const pin: Vec3 = [0, 0, 0];
			for (let i: number = k; i < end; i++) {
				const p: Vec3 = poses[i].worldPosition(joint);
				pin[0] += p[0]; pin[1] += p[1]; pin[2] += p[2];
			}
			const n: number = end - k;
			result.push({ start: k * dt, end: (end - 1) * dt, pin: [pin[0] / n, pin[1] / n, pin[2] / n] });
		}
		k = end;
	}
	return result;
}
