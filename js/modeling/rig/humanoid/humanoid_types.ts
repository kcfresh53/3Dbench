import { Vec3 } from './vec';

export type BuildStyle = 'blocky' | 'low_poly' | 'smooth';
export type FingerMode = 'none' | 'full';
export type ArmPose = 't_pose' | 'a_pose' | 'relaxed';
export type NamingConvention = 'godot' | 'unity' | 'mixamo' | 'simple';
export type Side = 'L' | 'R';

export interface HumanoidParams {
	/** Total height in model units */
	height: number
	head_scale: number
	neck_length: number
	torso_length: number
	leg_length: number
	arm_length: number
	shoulder_width: number
	hip_width: number
	/** Front to back thickness of torso and head */
	body_depth: number
	limb_thickness: number
	hand_scale: number
	foot_scale: number
	spine_bones: number
	arm_pose: ArmPose
	fingers: FingerMode
	toes: boolean
	style: BuildStyle
	root_bone: boolean
	naming: NamingConvention
	generate_mesh: boolean
	single_mesh: boolean
	auto_uv: boolean
}

/** A bone described by canonical id and world space head/tail. Rotation is always zero, bones are axis aligned. */
export interface BoneSpec {
	id: string
	parent: string | null
	head: Vec3
	tail: Vec3
	/** The head sits at the tail of the parent */
	connected: boolean
}

/** Vertex-weighted polygon mesh. Weights refer to canonical bone ids. */
export interface MeshSpec {
	name: string
	vertices: Vec3[]
	vertex_weights: Record<string, number>[]
	faces: number[][]
}

export interface ComponentOutput {
	bones: BoneSpec[]
	meshes: MeshSpec[]
}

/** Body landmarks shared by all components, computed once from the parameters */
export interface Landmarks {
	height: number
	hip_y: number
	neck_base_y: number
	head_base_y: number
	head_height: number
	shoulder_y: number
	shoulder_x: number
	hip_x: number
	knee_y: number
	ankle_y: number
	foot_length: number
	foot_width: number
	torso_depth: number
	/** Canonical ids of the spine chain from pelvis to top */
	spine_ids: string[]
	/** Number of rings per segment and how much neighboring bones share weights */
	weight_blend: number
	sides: number
	mesh_enabled: boolean
}

export interface BuildContext {
	params: HumanoidParams
	landmarks: Landmarks
}

export interface HumanoidComponent {
	readonly id: string
	build(context: BuildContext): ComponentOutput
}

export interface HumanoidPreset {
	label: string
	values: Partial<HumanoidParams>
}

export const DEFAULT_HUMANOID: HumanoidParams = {
	height: 32,
	head_scale: 1,
	neck_length: 1,
	torso_length: 1,
	leg_length: 1,
	arm_length: 1,
	shoulder_width: 1,
	hip_width: 1,
	body_depth: 1,
	limb_thickness: 1,
	hand_scale: 1,
	foot_scale: 1,
	spine_bones: 2,
	arm_pose: 'a_pose',
	fingers: 'full',
	toes: true,
	style: 'low_poly',
	root_bone: true,
	naming: 'godot',
	generate_mesh: true,
	single_mesh: false,
	auto_uv: true,
};

export const HUMANOID_PRESETS: Record<string, HumanoidPreset> = {
	average: { label: 'Average', values: {} },
	stylized: {
		label: 'Stylized',
		values: { head_scale: 1.5, leg_length: 0.8, torso_length: 0.95, arm_length: 0.9, hand_scale: 1.2, foot_scale: 1.2, limb_thickness: 1.1 },
	},
	chibi: {
		label: 'Chibi',
		values: { head_scale: 2.4, leg_length: 0.55, torso_length: 0.8, arm_length: 0.65, neck_length: 0.3, limb_thickness: 1.3, hand_scale: 1.2, foot_scale: 1.3, body_depth: 1.2 },
	},
	heroic: {
		label: 'Heroic',
		values: { head_scale: 0.9, leg_length: 1.05, shoulder_width: 1.3, hip_width: 0.95, limb_thickness: 1.25, torso_length: 1.05, arm_length: 1.05 },
	},
	child: {
		label: 'Child',
		values: { head_scale: 1.4, leg_length: 0.8, arm_length: 0.85, torso_length: 0.9, neck_length: 0.7, shoulder_width: 0.8, limb_thickness: 0.9 },
	},
	blocky: {
		label: 'Blocky',
		values: { style: 'blocky', head_scale: 1.15, limb_thickness: 1.3, fingers: 'none', toes: false, spine_bones: 2, body_depth: 1.2 },
	},
};
