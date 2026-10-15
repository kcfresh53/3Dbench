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
			const feminine = params.chest_shape;
			const waist = Math.max(L.hip_x * 1.4, L.shoulder_x * 0.66) * params.waist_width;
			const stations: Station[] = [
				{ t: -0.08, ru: L.hip_x * (1.78 - feminine * 0.2), rv: L.torso_depth * 0.86 },
				{ t: 0.16, ru: L.hip_x * (1.82 - feminine * 0.2), rv: L.torso_depth * 1.05 },
				{ t: 0.26, ru: L.hip_x * (1.6 - feminine * 0.16), rv: L.torso_depth * 0.96 },
				{ t: 0.3, ru: waist * 1.08, rv: L.torso_depth * 0.86 },
				{ t: 0.42, ru: waist, rv: L.torso_depth * 0.78 },
				{ t: 0.56, ru: waist * 1.1, rv: L.torso_depth * 0.88 },
				{ t: 0.65, ru: L.shoulder_x * 0.86, rv: L.torso_depth * 1.08 },
				{ t: 0.76, ru: L.shoulder_x * 0.99, rv: L.torso_depth * 1.12 },
				{ t: 0.87, ru: L.shoulder_x * 1.02, rv: L.torso_depth * 0.98 },
				{ t: 0.95, ru: L.shoulder_x * 0.87, rv: L.torso_depth * 0.75 },
				{ t: 1, ru: neck_radius, rv: neck_radius * 0.95 },
			];
			const torso_mesh = buildChainLoft({ name: 'torso', bones: chain, stations, up_hint: [0, 0, -1] }, { ...settings, sides: settings.rigid ? 4 : 12 });
			if (!settings.rigid) for (const v of torso_mesh.vertices) {
				const t = (v[1] - L.hip_y) / torso;
				if (Math.abs(t + 0.08) < 1e-5) v[1] += 0.032 * L.height * Math.abs(v[0]) / (L.hip_x * (1.78 - feminine * 0.2));
				const front = Math.max(0, -v[2] / L.torso_depth);
				const chest = Math.exp(-Math.pow((t - 0.7) / 0.115, 2));
				const lobe = Math.exp(-Math.pow((Math.abs(v[0]) / L.shoulder_x - 0.5) / 0.3, 2));
				// Pectorals / bust use two broad lobes with a sternum, not an enlarged oval tube.
				v[2] -= front * chest * lobe * L.torso_depth * (0.22 + feminine * 1.15);
				// Subtle lumbar curve and fuller seat establish a readable side silhouette.
				if (v[2] > 0) v[2] += L.torso_depth * (0.2 * Math.exp(-Math.pow((t - 0.08) / 0.18, 2)) - 0.12 * Math.exp(-Math.pow((t - 0.4) / 0.15, 2)));
			}
			meshes.push(torso_mesh);
		}
		return { bones, meshes };
	}
}
