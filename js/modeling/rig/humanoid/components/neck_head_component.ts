import { BoneSpec, BuildContext, ComponentOutput, HumanoidComponent, MeshSpec } from '../humanoid_types';
import { buildChainLoft, Station } from '../chain_loft';
import { ChainBone } from '../loft';
import { loftSettingsFor } from './component_utils';

export class NeckHeadComponent implements HumanoidComponent {
	readonly id: string = 'neck_head';

	build(context: BuildContext): ComponentOutput {
		const { params, landmarks: L } = context;
		const top_spine: string = L.spine_ids[L.spine_ids.length - 1];
		const bones: BoneSpec[] = [
			{ id: 'neck', parent: top_spine, head: [0, L.neck_base_y, 0], tail: [0, L.head_base_y, 0], connected: true },
			{ id: 'head', parent: 'neck', head: [0, L.head_base_y, 0], tail: [0, L.height, 0], connected: true },
		];
		const meshes: MeshSpec[] = [];
		if (L.mesh_enabled) {
			const settings = loftSettingsFor(context);
			const neck_length: number = Math.max(1e-4, L.head_base_y - L.neck_base_y);
			const total: number = neck_length + L.head_height;
			const neck_radius: number = 0.026 * L.height * Math.sqrt(params.limb_thickness);
			const neck_chain: ChainBone[] = [
				{ id: 'neck', head: bones[0].head, tail: bones[0].tail },
				{ id: 'head', head: bones[1].head, tail: bones[1].tail },
			];
			const neck_end: number = neck_length / total;
			meshes.push(buildChainLoft({
				name: 'neck',
				bones: neck_chain,
				stations: [
					{ t: -0.25 * L.height / total, ru: neck_radius * 1.1, rv: neck_radius * 1.05 },
					{ t: neck_end * 1.08, ru: neck_radius, rv: neck_radius * 0.95 },
				],
				up_hint: [0, 0, -1],
			}, settings));

			const hw: number = 0.34 * L.head_height;
			const hd: number = 0.4 * L.head_height;
			const stations: Station[] = settings.rigid
				? [{ t: 0, ru: hw, rv: hd }, { t: 1, ru: hw, rv: hd }]
				: [
					{ t: 0, ru: hw * 0.62, rv: hd * 0.6 },
					{ t: 0.14, ru: hw * 0.82, rv: hd * 0.85 },
					{ t: 0.4, ru: hw * 0.98, rv: hd },
					{ t: 0.7, ru: hw, rv: hd * 0.97 },
					{ t: 0.9, ru: hw * 0.8, rv: hd * 0.78 },
					{ t: 1, ru: hw * 0.45, rv: hd * 0.45 },
				];
			meshes.push(buildChainLoft({
				name: 'head',
				bones: [{ id: 'head', head: bones[1].head, tail: bones[1].tail }],
				stations,
				up_hint: [0, 0, -1],
			}, settings));
		}
		return { bones, meshes };
	}
}
