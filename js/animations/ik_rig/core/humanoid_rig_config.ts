import type { IKRigConfig, GoalConfig, SolverConfig, RuleConfig, JointKey, Side } from './rig_types';
import { HUMANOID_SIDES, sidedKey } from './rig_types';

/** Builds the default humanoid rig for the joint keys that are bound. Limbs that are missing are skipped. */
export function createHumanoidRigConfig(available: ReadonlySet<JointKey>, name: string = 'Humanoid IK Rig'): IKRigConfig {
	const has = (...keys: JointKey[]): boolean => keys.every((key: JointKey): boolean => available.has(key));
	const goals: GoalConfig[] = [];
	const solvers: SolverConfig[] = [];
	const leg_goals: string[] = [];
	const hand_goals: string[] = [];
	const limb_solvers: SolverConfig[] = [];

	for (const side of HUMANOID_SIDES) {
		const s = (base: string): JointKey => sidedKey(base, side);
		if (has(s('upper_leg'), s('lower_leg'), s('foot'))) {
			goals.push(goal(`foot_${side}`, `Foot ${label(side)}`, 'foot', s('foot'), s('lower_leg'), 'follow', 1, 1, 1));
			leg_goals.push(`foot_${side}`);
			limb_solvers.push(limb(`leg_${side}`, `foot_${side}`, s('upper_leg'), s('lower_leg'), s('foot')));
		}
		if (has(s('upper_arm'), s('lower_arm'), s('hand'))) {
			goals.push(goal(`hand_${side}`, `Hand ${label(side)}`, 'hand', s('hand'), s('lower_arm'), 'follow', 1, 1, 1));
			hand_goals.push(`hand_${side}`);
			limb_solvers.push(limb(`arm_${side}`, `hand_${side}`, s('upper_arm'), s('lower_arm'), s('hand')));
		}
	}

	const spine_keys: JointKey[] = ['spine_1', 'spine_2', 'spine_3'].filter((key: JointKey): boolean => available.has(key));
	if (available.has('pelvis') && leg_goals.length) {
		solvers.push({
			id: 'body', kind: 'body', enabled: true, weight: 1,
			pelvis: 'pelvis', leg_goals, hand_goals,
			vertical_weight: 1, horizontal_weight: 0, tilt_weight: 0.5, max_tilt_deg: 15, max_extension: 0.98, hand_pull: 0, crouch: 0,
		});
	}
	if (spine_keys.length) {
		const chest: JointKey = spine_keys[spine_keys.length - 1];
		goals.push(goal('chest', 'Chest', 'chest', chest, undefined, 'follow', 0, 1, 0));
		solvers.push({ id: 'spine', kind: 'spine', enabled: true, weight: 1, joints: spine_keys, goal: 'chest', lean_forward_deg: 0, lean_side_deg: 0, distribution: spine_keys.map((): number => 1) });
	}
	solvers.push(...limb_solvers);
	if (has('head')) {
		const aim_joints: JointKey[] = [...(has('neck') ? ['neck'] : []), 'head'];
		goals.push(goal('look_at', 'Look At', 'head', 'head', undefined, 'handle', 1, 0, 0));
		solvers.push({
			id: 'look', kind: 'aim', enabled: true, weight: 1, goal: 'look_at',
			joints: aim_joints, distribution: aim_joints.length == 2 ? [0.4, 0.6] : [1], max_angle_deg: 70,
		});
	}

	const rules: RuleConfig[] = [
		{ id: 'handles', kind: 'handle', enabled: true, weight: 1 },
		{ id: 'foot_lock', kind: 'foot_lock', enabled: true, weight: 1, goals: leg_goals, speed_threshold: 0.35, lift_threshold: 0.06, blend_time: 0.12, require_root_motion: true },
		{ id: 'ground', kind: 'ground', enabled: true, weight: 1, goals: leg_goals, lift_threshold: 0.08, swing_follow: 0.5, slope_weight: 1 },
	];
	return { version: 1, name, forward: [0, 0, 1], goals, rules, solvers };
}

function label(side: Side): string {
	return side == 'l' ? 'L' : 'R';
}

function goal(
	id: string, name: string, kind: GoalConfig['kind'], effector: JointKey, pole_joint: JointKey | undefined,
	mode: GoalConfig['mode'], position_weight: number, rotation_weight: number, pole_weight: number,
): GoalConfig {
	return { id, label: name, kind, effector, pole_joint, mode, position_weight, rotation_weight, pole_weight };
}

function limb(id: string, goal_id: string, root: JointKey, mid: JointKey, end: JointKey): SolverConfig {
	return {
		id, kind: 'limb', enabled: true, weight: 1, goal: goal_id, root, mid, end,
		softness: 0, min_interior_deg: 12, max_interior_deg: 180,
	};
}
