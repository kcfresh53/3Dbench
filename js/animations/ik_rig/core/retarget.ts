/**
 * Animation retargeting through the IK rig.
 *
 * Rotations of the body are transferred as world-space deltas from the bind pose. The limbs are then not
 * copied but rebuilt: hand and foot goals are taken from the source animation, scaled by the limb length
 * ratio, and solved on the target skeleton by the IK rig (including its rules such as ground adaption
 * and foot locking). Proportion differences therefore don't cause floating feet or sliding.
 */
import { Vec3, Quat, add, sub, scale, normalize, length, projectOnPlane, quatMul, quatConjugate, quatRotate, quatFromAxisAngle, quatFromTo } from './math';
import { Pose, JointTransform } from './skeleton';
import type { RigBinding } from './rig_binding';
import { IKRig, GoalOverride, EvaluateResult } from './ik_rig';
import { analyseContacts } from '../modifiers/contact_analysis';
import type { RuleProviders } from '../modifiers/rule_context';
import type { FootLockRuleConfig, GoalConfig, JointKey, LimbSolverConfig, SolverConfig, RuleConfig } from './rig_types';

export interface RetargetSource {
	binding: RigBinding;
	/** Pose of the source animation at a time */
	sample: (time: number) => Pose;
	duration: number;
}

export interface RetargetOptions {
	fps: number;
	/** Providers for rules (ground, attachments); contacts are produced here */
	providers?: RuleProviders;
	/** Run the IK rig on the transferred pose. When false only the world-delta transfer is returned. */
	solve_ik?: boolean;
	/** Keys that follow the source translation (scaled by the hip height ratio) */
	translated_joints?: JointKey[];
}

export interface RetargetedFrame {
	time: number;
	pose: Pose;
}

/** Rotation about +Y that turns the source facing direction onto the target facing direction */
export function facingAlignment(source: Vec3, target: Vec3): Quat {
	const a: Vec3 = normalize([source[0], 0, source[2]]);
	const b: Vec3 = normalize([target[0], 0, target[2]]);
	const angle: number = Math.atan2(a[2] * b[0] - a[0] * b[2], a[0] * b[0] + a[2] * b[2]);
	return quatFromAxisAngle([0, 1, 0], angle);
}

export function retargetClip(source: RetargetSource, target_rig: IKRig, options: RetargetOptions): RetargetedFrame[] {
	const target: RigBinding = target_rig.binding;
	const align: Quat = facingAlignment(source.binding.forward, target.forward);
	const align_inverse: Quat = quatConjugate(align);
	const height_ratio: number = target.body_scale / source.binding.body_scale;
	const translated: JointKey[] = options.translated_joints ?? ['root', 'pelvis'];

	const shared: { key: JointKey; source: number; target: number }[] = [];
	for (const [key, target_index] of Object.entries(target.toRecord())) {
		if (source.binding.has(key)) shared.push({ key, source: source.binding.joint(key), target: target_index });
	}
	shared.sort((a, b): number => a.target - b.target);

	const frame_count: number = Math.max(1, Math.round(source.duration * options.fps)) + 1;
	const times: number[] = Array.from({ length: frame_count }, (_: unknown, k: number): number => Math.min(source.duration, k / options.fps));

	const transferred: Pose[] = [];
	const overrides: Map<string, GoalOverride>[] = [];
	for (const time of times) {
		const src: Pose = source.sample(time);
		const pose: Pose = transferPose(src, source.binding, target, shared, align, align_inverse, height_ratio, translated);
		transferred.push(pose);
		overrides.push(options.solve_ik === false ? new Map() : limbOverrides(src, source.binding, pose, target, align));
	}
	if (options.solve_ik === false) return times.map((time: number, k: number): RetargetedFrame => ({ time, pose: transferred[k] }));

	// pass 1 without foot locking, only to find out where the feet are planted
	const base_providers: RuleProviders = { ...(options.providers ?? {}), contacts: null };
	let first_pass: EvaluateResult[] = transferred.map((pose: Pose, k: number): EvaluateResult =>
		target_rig.evaluate(pose, { time: times[k], providers: base_providers, overrides: overrides[k] }));

	const lock: FootLockRuleConfig | undefined = target.config.rules.find(
		(rule: RuleConfig): boolean => rule.kind == 'foot_lock' && rule.enabled,
	) as FootLockRuleConfig | undefined;
	if (!lock) return times.map((time: number, k: number): RetargetedFrame => ({ time, pose: first_pass[k].pose }));

	const analysis = analyseContacts(target, lock, {
		sample: (time: number): Pose => first_pass[Math.min(frame_count - 1, Math.round(time * options.fps))].pose,
		duration: source.duration,
		fps: options.fps,
	});
	const providers: RuleProviders = { ...base_providers, contacts: analysis };
	first_pass = [];
	return times.map((time: number, k: number): RetargetedFrame => ({
		time,
		pose: target_rig.evaluate(transferred[k], { time, providers, overrides: overrides[k] }).pose,
	}));
}

/** World-space delta transfer of rotations and scaled translation of the body joints */
function transferPose(
	src: Pose, source: RigBinding, target: RigBinding, shared: { key: JointKey; source: number; target: number }[],
	align: Quat, align_inverse: Quat, height_ratio: number, translated: JointKey[],
): Pose {
	const local: JointTransform[] = target.skeleton.bind_local.map((t: JointTransform): JointTransform => ({
		position: [...t.position] as Vec3, rotation: [...t.rotation] as Quat,
	}));
	const pose: Pose = new Pose(target.skeleton, local);
	const by_target: Map<number, { key: JointKey; source: number }> = new Map(shared.map((s): [number, { key: JointKey; source: number }] => [s.target, s]));

	for (let j: number = 0; j < target.skeleton.count; j++) {
		const mapping = by_target.get(j);
		if (mapping) {
			const bind_s: JointTransform = source.skeleton.bind_world[mapping.source];
			const delta: Quat = quatMul(src.worldRotation(mapping.source), quatConjugate(bind_s.rotation));
			const world_delta: Quat = quatMul(align, quatMul(delta, align_inverse));
			pose.setWorldRotation(j, quatMul(world_delta, target.skeleton.bind_world[j].rotation));
			if (translated.includes(mapping.key)) {
				const moved: Vec3 = quatRotate(align, sub(src.worldPosition(mapping.source), bind_s.position));
				const wanted: Vec3 = add(target.skeleton.bind_world[j].position, scale(moved, height_ratio));
				pose.setWorldPosition(j, wanted);
			}
		} else {
			pose.updateSubtree(j);
		}
	}
	return pose;
}

/** Hand and foot goals from the source, relative to the limb root and scaled by the limb length ratio */
function limbOverrides(src: Pose, source: RigBinding, transferred: Pose, target: RigBinding, align: Quat): Map<string, GoalOverride> {
	const overrides: Map<string, GoalOverride> = new Map();
	for (const goal of target.config.goals) {
		const limb: LimbSolverConfig | undefined = target.config.solvers.find(
			(s: SolverConfig): boolean => s.kind == 'limb' && s.goal == goal.id,
		) as LimbSolverConfig | undefined;
		const source_goal: GoalConfig | undefined = source.config.goals.find((g: GoalConfig): boolean => g.id == goal.id);
		if (!limb || !source_goal || !source.has(limb.root) || !source.has(limb.mid) || !source.has(limb.end)) continue;
		if (!target.has(limb.root) || !target.has(limb.mid) || !target.has(limb.end)) continue;

		const s_root: number = source.joint(limb.root);
		const s_mid: number = source.joint(limb.mid);
		const s_end: number = source.joint(limb.end);
		const source_length: number = limbLength(source, s_root, s_mid, s_end);
		const target_length: number = limbLength(target, target.joint(limb.root), target.joint(limb.mid), target.joint(limb.end));
		const ratio: number = source_length > 1e-9 ? target_length / source_length : 1;

		const reach: Vec3 = sub(src.worldPosition(s_end), src.worldPosition(s_root));
		const position: Vec3 = add(transferred.worldPosition(target.joint(limb.root)), scale(quatRotate(align, reach), ratio));

		const axis: Vec3 = length(reach) > 1e-9 ? normalize(reach) : [0, 1, 0];
		const bend: Vec3 = projectOnPlane(sub(src.worldPosition(s_mid), src.worldPosition(s_root)), axis);
		overrides.set(goal.id, { position, pole_direction: length(bend) > 1e-5 ? quatRotate(align, normalize(bend)) : null });
	}
	return overrides;
}

function limbLength(binding: RigBinding, root: number, mid: number, end: number): number {
	const world: JointTransform[] = binding.skeleton.bind_world;
	return length(sub(world[mid].position, world[root].position)) + length(sub(world[end].position, world[mid].position));
}
