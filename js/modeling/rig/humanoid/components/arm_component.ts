import { BoneSpec, BuildContext, ComponentOutput, HumanoidComponent, MeshSpec, Side } from '../humanoid_types';
import { buildChainLoft, Station } from '../chain_loft';
import { ChainBone } from '../loft';
import { Vec3, add, normalize, scale } from '../vec';
import { HandComponent } from './hand_component';
import { loftSettingsFor } from './component_utils';

const POSE_ANGLES: Record<string, number> = { t_pose: 0, a_pose: 40, relaxed: 75 };

/** Clavicle, upper arm, forearm and the attached hand */
export class ArmComponent implements HumanoidComponent {
	readonly id: string;
	private readonly x_sign: number;

	constructor(private readonly side: Side) {
		this.id = 'arm.' + side;
		this.x_sign = side == 'R' ? 1 : -1;
	}

	build(context: BuildContext): ComponentOutput {
		const { params, landmarks: L } = context;
		const sx: number = this.x_sign;
		const suffix: string = '.' + this.side;
		const H: number = L.height;
		const angle: number = (POSE_ANGLES[params.arm_pose] ?? 40) * Math.PI / 180;

		const clavicle_head: Vec3 = [sx * 0.02 * H, L.shoulder_y, 0];
		const shoulder: Vec3 = [sx * L.shoulder_x, L.shoulder_y, 0];
		const upper_dir: Vec3 = [sx * Math.cos(angle), -Math.sin(angle), 0];
		// slight forward bend in the elbow so inverse kinematics knows where the elbow points
		const forearm_dir: Vec3 = params.arm_pose == 't_pose' ? upper_dir : normalize(add(upper_dir, [0, 0, -0.12]));
		const upper_length: number = 0.17 * H * params.arm_length;
		const lower_length: number = 0.15 * H * params.arm_length;
		const elbow: Vec3 = add(shoulder, scale(upper_dir, upper_length));
		const wrist: Vec3 = add(elbow, scale(forearm_dir, lower_length));
		const top_spine: string = L.spine_ids[L.spine_ids.length - 1];

		const bones: BoneSpec[] = [
			{ id: 'shoulder' + suffix, parent: top_spine, head: clavicle_head, tail: shoulder, connected: false },
			{ id: 'upper_arm' + suffix, parent: 'shoulder' + suffix, head: shoulder, tail: elbow, connected: true },
			{ id: 'lower_arm' + suffix, parent: 'upper_arm' + suffix, head: elbow, tail: wrist, connected: true },
		];
		const meshes: MeshSpec[] = [];
		if (L.mesh_enabled) {
			const settings = loftSettingsFor(context);
			const thick: number = params.limb_thickness;
			const r_shoulder: number = 0.034 * H * thick;
			const r_elbow: number = 0.027 * H * thick;
			const r_wrist: number = 0.02 * H * thick;
			const elbow_t: number = upper_length / (upper_length + lower_length);
			const chain: ChainBone[] = [
				{ id: 'upper_arm' + suffix, head: shoulder, tail: elbow },
				{ id: 'lower_arm' + suffix, head: elbow, tail: wrist },
			];
			const stations: Station[] = settings.rigid
				? [
					{ t: -0.03, ru: r_shoulder * 1.05, rv: r_shoulder * 1.05 },
					{ t: elbow_t, ru: r_elbow * 1.1, rv: r_elbow * 1.1 },
					{ t: 1, ru: r_wrist * 1.1, rv: r_wrist * 1.1 },
				]
				: [
					{ t: -0.04, ru: r_shoulder * 0.95, rv: r_shoulder * 0.95 },
					{ t: elbow_t * 0.25, ru: r_shoulder, rv: r_shoulder },
					{ t: elbow_t, ru: r_elbow, rv: r_elbow },
					{ t: elbow_t + (1 - elbow_t) * 0.3, ru: r_elbow * 1.08, rv: r_elbow * 1.08 },
					{ t: 1, ru: r_wrist, rv: r_wrist },
				];
			meshes.push(buildChainLoft({ name: 'arm' + suffix, bones: chain, stations, up_hint: [0, 0, 1] }, settings));
		}

		const hand: ComponentOutput = new HandComponent(this.side, wrist, forearm_dir, 'lower_arm' + suffix).build(context);
		return { bones: bones.concat(hand.bones), meshes: meshes.concat(hand.meshes) };
	}
}
