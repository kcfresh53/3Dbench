import { HumanoidParams, Landmarks } from './humanoid_types';

const SPINE_IDS: string[] = ['hips', 'spine', 'chest', 'upper_chest'];

/**
 * Derives the key body measurements. Proportion multipliers are normalized so that the total height always
 * matches the requested height, no matter how the multipliers are set.
 */
export function computeLandmarks(params: HumanoidParams): Landmarks {
	const leg: number = 0.52 * params.leg_length;
	const torso: number = 0.30 * params.torso_length;
	const neck: number = 0.05 * params.neck_length;
	const head: number = 0.13 * params.head_scale;
	const k: number = params.height / (leg + torso + neck + head);
	const H: number = params.height;

	const hip_y: number = leg * k;
	const neck_base_y: number = hip_y + torso * k;
	const head_base_y: number = neck_base_y + neck * k;
	const ankle_y: number = 0.045 * H;
	const spine_count: number = Math.min(3, Math.max(1, Math.round(params.spine_bones)));

	return {
		height: H,
		hip_y,
		neck_base_y,
		head_base_y,
		head_height: head * k,
		shoulder_y: neck_base_y - 0.03 * H,
		shoulder_x: 0.115 * H * params.shoulder_width,
		hip_x: 0.055 * H * params.hip_width,
		knee_y: (hip_y + ankle_y) / 2 + 0.01 * H,
		ankle_y,
		foot_length: 0.12 * H * params.foot_scale,
		foot_width: 0.034 * H * params.foot_scale,
		torso_depth: 0.062 * H * params.body_depth,
		spine_ids: SPINE_IDS.slice(0, spine_count + 1),
		weight_blend: params.style == 'blocky' ? 0 : (params.style == 'low_poly' ? 0.3 : 0.4),
		sides: params.style == 'blocky' ? 4 : (params.style == 'low_poly' ? 8 : 12),
		mesh_enabled: params.generate_mesh,
	};
}
