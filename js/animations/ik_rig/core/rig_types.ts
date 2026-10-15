/**
 * Declarative (serialisable) description of an IK Rig.
 *
 * The structure follows the layering from the "IK Rig: Procedural Pose" talk:
 *   animation (FK) -> goals extracted from the pose -> goal rules (procedural modification) -> solver stack -> final pose.
 * Joints are referenced by rig-local keys (for example 'upper_leg_l'). A binding maps these keys to real bones.
 */
import type { Vec3 } from './math';

export type JointKey = string;
export type GoalKind = 'foot' | 'hand' | 'head' | 'chest' | 'generic';
/** follow: the goal starts at the animated effector. handle: the goal is placed by an external handle (when one exists). */
export type GoalMode = 'follow' | 'handle';

export interface GoalConfig {
	id: string;
	label: string;
	kind: GoalKind;
	/** Joint whose transform the goal describes */
	effector: JointKey;
	/** Joint used to read the bend direction (knee / elbow) from the animation */
	pole_joint?: JointKey;
	mode: GoalMode;
	position_weight: number;
	rotation_weight: number;
	pole_weight: number;
}

interface SolverBase {
	id: string;
	enabled: boolean;
	/** 0..1 influence of the whole solver */
	weight: number;
}

/** Moves and tilts the pelvis so that all limbs can reach their goals (the "body" solver) */
export interface BodySolverConfig extends SolverBase {
	kind: 'body';
	pelvis: JointKey;
	/** Leg goals that drive the pelvis */
	leg_goals: string[];
	/** Hand goals that can pull the pelvis a little (0 disables) */
	hand_goals: string[];
	vertical_weight: number;
	horizontal_weight: number;
	tilt_weight: number;
	max_tilt_deg: number;
	/** Longest leg extension allowed when the pelvis is lowered or raised, as a fraction of leg length */
	max_extension: number;
	hand_pull: number;
	/** Lower the pelvis by this fraction of bind body height; feet retain their goals. */
	crouch?: number;
}

/** Distributes a rotation goal over a spine chain */
export interface SpineSolverConfig extends SolverBase {
	kind: 'spine';
	joints: JointKey[];
	/** Goal whose rotation the last spine joint should keep (normally the FK chest orientation) */
	goal: string;
	/** Procedural chest lean in degrees relative to animated body facing. */
	lean_forward_deg?: number;
	lean_side_deg?: number;
	/** Relative share of the correction per joint. Missing entries default to 1. */
	distribution: number[];
}

/** Analytic two bone solver with soft reach, pole and bend limits */
export interface LimbSolverConfig extends SolverBase {
	kind: 'limb';
	goal: string;
	root: JointKey;
	mid: JointKey;
	end: JointKey;
	/** 0..1: how early the limb starts to slow down before full extension */
	softness: number;
	/** Interior angle limits at the mid joint in degrees. A straight limb is 180. */
	min_interior_deg: number;
	max_interior_deg: number;
}

/** FABRIK solver for arbitrary chains (tails, tentacles, long necks) */
export interface ChainSolverConfig extends SolverBase {
	kind: 'chain';
	goal: string;
	joints: JointKey[];
	iterations: number;
	tolerance: number;
	max_bend_deg: number;
}

/** Rotates a chain so its aim axis points at the goal position (head look-at, chest lean, ...) */
export interface AimSolverConfig extends SolverBase {
	kind: 'aim';
	goal: string;
	joints: JointKey[];
	/** Share of the rotation per joint, normalised internally */
	distribution: number[];
	/** Direction the last joint looks along, expressed in the rig's rest pose (world axes at bind). Defaults to rig forward. */
	aim_axis?: Vec3;
	max_angle_deg: number;
}

export type SolverConfig = BodySolverConfig | SpineSolverConfig | LimbSolverConfig | ChainSolverConfig | AimSolverConfig;
export type SolverKind = SolverConfig['kind'];

interface RuleBase {
	id: string;
	enabled: boolean;
	weight: number;
}

/** Replaces goals in 'handle' mode with the transform of their handle */
export interface HandleRuleConfig extends RuleBase {
	kind: 'handle';
}

/** Adapts feet to the ground height and slope */
export interface GroundRuleConfig extends RuleBase {
	kind: 'ground';
	goals: string[];
	/** Height above the ground at which a foot stops counting as planted, as a fraction of the body scale */
	lift_threshold: number;
	/** How much of the ground height a lifted foot still follows (0 = none, 1 = full) */
	swing_follow: number;
	/** How strongly a planted foot aligns to the ground normal */
	slope_weight: number;
}

/** Pins planted feet to the ground (removes foot sliding). Needs animations with root motion. */
export interface FootLockRuleConfig extends RuleBase {
	kind: 'foot_lock';
	goals: string[];
	/** Maximum foot speed for a contact, in body scales per second */
	speed_threshold: number;
	/** Maximum height above the ground for a contact, as a fraction of the body scale */
	lift_threshold: number;
	/** Seconds used to blend the lock in and out */
	blend_time: number;
	/** When true the lock only runs if the animation actually travels */
	require_root_motion: boolean;
}

/** Makes a goal follow an external transform such as a held prop */
export interface AttachRuleConfig extends RuleBase {
	kind: 'attach';
	goal: string;
	/** Identifier resolved by the host to a world transform */
	attachment: string;
	position: boolean;
	rotation: boolean;
	offset: Vec3;
}

/** Adds a constant offset to a goal */
export interface OffsetRuleConfig extends RuleBase {
	kind: 'offset';
	goal: string;
	space: 'world' | 'body' | 'goal';
	offset: Vec3;
}

/** Procedural oscillation added to a goal (breathing, a bouncing carried box, ...) */
export interface OscillateRuleConfig extends RuleBase {
	kind: 'oscillate';
	goal: string;
	amplitude: Vec3;
	frequency: number;
	phase: number;
}

export type RuleConfig = HandleRuleConfig | GroundRuleConfig | FootLockRuleConfig | AttachRuleConfig | OffsetRuleConfig | OscillateRuleConfig;
export type RuleKind = RuleConfig['kind'];

export interface IKRigConfig {
	version: 1;
	name: string;
	/** Used when the facing direction cannot be detected from the bind pose */
	forward: Vec3;
	goals: GoalConfig[];
	/** Evaluated in order, top to bottom */
	rules: RuleConfig[];
	/** Evaluated in order, top to bottom */
	solvers: SolverConfig[];
}

/** Rig-local joint keys of a standard humanoid */
export type Side = 'l' | 'r';
export const HUMANOID_SIDES: readonly Side[] = ['l', 'r'];
export const HUMANOID_CENTER_KEYS: readonly JointKey[] = ['root', 'pelvis', 'spine_1', 'spine_2', 'spine_3', 'neck', 'head'];
export const HUMANOID_SIDED_KEYS: readonly JointKey[] = ['clavicle', 'upper_arm', 'lower_arm', 'hand', 'upper_leg', 'lower_leg', 'foot', 'toes'];

export function sidedKey(base: string, side: Side): JointKey {
	return `${base}_${side}`;
}

export function humanoidJointKeys(): JointKey[] {
	const keys: JointKey[] = [...HUMANOID_CENTER_KEYS];
	for (const side of HUMANOID_SIDES) for (const base of HUMANOID_SIDED_KEYS) keys.push(sidedKey(base, side));
	return keys;
}
