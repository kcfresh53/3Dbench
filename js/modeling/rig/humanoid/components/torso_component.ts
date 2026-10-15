import { BoneSpec, BuildContext, ComponentOutput, HumanoidComponent, MeshSpec } from '../humanoid_types';
import { buildChainLoft, Station } from '../chain_loft';
import { ChainBone } from '../loft';
import { loftSettingsFor } from './component_utils';

/** Root, pelvis and spine chain together with the torso body */
export class TorsoComponent implements HumanoidComponent {
	readonly id: string = 'torso';

	build(context: BuildContext): ComponentOutput {
		const { params, landmarks: L } = context;
		const bones: BoneSpec[] = [];
		if (params.root_bone) {
			bones.push({ id: 'root', parent: null, head: [0, 0, 0], tail: [0, 0.08 * L.height, 0], connected: false });
		}

		const count: number = L.spine_ids.length;
		const torso: number = L.neck_base_y - L.hip_y;
		const pelvis_length: number = 0.18 * torso;
		const segment: number = (torso - pelvis_length) / (count - 1);
		const joints: number[] = [L.hip_y, L.hip_y + pelvis_length];
		for (let i: number = 2; i <= count; i++) joints.push(L.hip_y + pelvis_length + segment * (i - 1));

		L.spine_ids.forEach((id: string, i: number) => {
			bones.push({
				id,
				parent: i == 0 ? (params.root_bone ? 'root' : null) : L.spine_ids[i - 1],
				head: [0, joints[i], 0],
				tail: [0, joints[i + 1], 0],
				connected: i > 0,
			});
		});

		const meshes: MeshSpec[] = [];
		if (L.mesh_enabled) {
			const chain: ChainBone[] = bones.filter((b: BoneSpec) => L.spine_ids.includes(b.id)).map((b: BoneSpec) => ({ id: b.id, head: b.head, tail: b.tail }));
			const settings = loftSettingsFor(context);
			const neck_radius: number = 0.026 * L.height;
			const fraction = (f: number): number => f;
			const stations: Station[] = settings.rigid
				? [
					{ t: -0.075 * L.height / torso, ru: L.hip_x * 1.7, rv: L.torso_depth * 0.9 },
					{ t: fraction(1.0), ru: L.shoulder_x * 0.9, rv: L.torso_depth * 0.9 },
				]
				: [
					{ t: -0.075 * L.height / torso, ru: L.hip_x * 1.35, rv: L.torso_depth * 0.85 },
					{ t: 0.04, ru: L.hip_x * 1.75, rv: L.torso_depth * 0.95 },
					{ t: 0.42, ru: Math.max(L.hip_x * 1.45, L.shoulder_x * 0.72), rv: L.torso_depth * 0.8 },
					{ t: 0.72, ru: L.shoulder_x * 0.92, rv: L.torso_depth },
					{ t: 0.97, ru: L.shoulder_x * 0.88, rv: L.torso_depth * 0.78 },
					{ t: 1.015, ru: neck_radius * 1.7, rv: neck_radius * 1.6 },
				];
			meshes.push(buildChainLoft({ name: 'torso', bones: chain, stations, up_hint: [0, 0, -1] }, settings));
		}
		return { bones, meshes };
	}
}
