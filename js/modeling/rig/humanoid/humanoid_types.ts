import { Vec3 } from './vec';

export type BuildStyle = 'blocky' | 'low_poly' | 'smooth';
export type FingerMode = 'none' | 'full';
export type ArmPose = 't_pose' | 'a_pose' | 'relaxed';
export type NamingConvention = 'godot' | 'unity' | 'mixamo' | 'simple';
export type Side = 'L' | 'R';

export interface HumanoidParams {
	/** Total height in model units */
	height: number
	/** Silhouette controls, independent of rig naming. */
	waist_width: number
	chest_shape: number
	head_width: number
	jaw_width: number
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
	/** Preserved per-corner UVs in normalized texture coordinates. */
	face_uvs?: [number, number][][]
	face_materials?: number[]
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
	/** Bundled or user-installed character template. */
	template?: string
	values: Partial<HumanoidParams>
}

export const DEFAULT_HUMANOID: HumanoidParams = {
	height: 32,
	waist_width: 1,
	chest_shape: 0,
	head_width: 1,
	jaw_width: 1,
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
	single_mesh: true,
	auto_uv: true,
};

/** Every preset stays low-poly; proportions can still be edited independently. */
export const HUMANOID_PRESETS: Record<string, HumanoidPreset> = {
	male: { label: 'Male base', template: 'bodiez_male', values: { auto_uv: false, arm_pose: 'a_pose' } },
	female: { label: 'Female base', template: 'bodiez_female', values: { auto_uv: false, arm_pose: 'a_pose' } },
	chibi_male: {
		label: 'Male Chibi base', template: 'chibi_male',
		values: { auto_uv: false, style: 'low_poly' },
	},
	chibi_female: {
		label: 'Female Chibi base', template: 'chibi_female',
		values: { auto_uv: false, style: 'low_poly' },
	},
};
