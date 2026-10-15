import { BoneSpec, BuildContext, ComponentOutput, HumanoidComponent, MeshSpec } from '../humanoid_types';
import { buildChainLoft, Station } from '../chain_loft';
import { ChainBone, loftRings } from '../loft';
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
					{ t: 0, ru: neck_radius * 1.1, rv: neck_radius * 1.05 },
					{ t: neck_end, ru: neck_radius, rv: neck_radius * 0.95 },
				],
				up_hint: [0, 0, -1],
			}, { ...settings, sides: settings.rigid ? 4 : 12 }));

			const hw: number = 0.38 * L.head_height * params.head_width;
			const hd: number = 0.43 * L.head_height;
			const stations: Station[] = settings.rigid
				? [{ t: 0, ru: hw, rv: hd }, { t: 1, ru: hw, rv: hd }]
				: [
					{ t: 0, ru: hw * 0.4 * params.jaw_width, rv: hd * 0.22 },
					{ t: 0.1, ru: hw * 0.65 * params.jaw_width, rv: hd * 0.48 },
					{ t: 0.22, ru: hw * 0.83 * params.jaw_width, rv: hd * 0.72 },
					{ t: 0.32, ru: hw * 0.94, rv: hd * 0.87 },
					{ t: 0.46, ru: hw, rv: hd * 0.99 },
					{ t: 0.65, ru: hw, rv: hd },
					{ t: 0.82, ru: hw * 0.88, rv: hd * 0.91 },
					{ t: 0.94, ru: hw * 0.57, rv: hd * 0.64 },
					{ t: 1, ru: hw * 0.18, rv: hd * 0.2 },
				];
			const head = buildChainLoft({
				name: 'head',
				bones: [{ id: 'head', head: bones[1].head, tail: bones[1].tail }],
				stations,
				up_hint: [0, 0, -1],
			}, { ...settings, sides: settings.rigid ? 4 : 12 });
			if (!settings.rigid) {
				for (let i = 0; i < head.vertices.length; i++) {
					const v = head.vertices[i], t = (v[1] - L.head_base_y) / L.head_height;
					const k = i % 12;
					// Chin projects in front of the neck; the cranium sits farther back.
					v[2] += hd * (-0.55 * Math.max(0, 1 - t / 0.5) + 0.08 * Math.min(1, t / 0.5));
					if (i >= head.vertices.length - 2) continue;
					if (k === 3) {
						const nose = Math.max(0, 1 - Math.abs(t - 0.32) / 0.13);
						v[2] -= L.head_height * 0.09 * nose;
					}
					// Flatter facial plane and subtle eye sockets, leaving space for face textures.
					if (k === 2 || k === 4) {
						if (t >= 0.22 && t <= 0.65) v[2] -= hd * 0.07;
						if (Math.abs(t - 0.46) < 0.015) v[2] += hd * 0.05;
					}
				}
				for (const sign of [-1, 1]) {
					meshes.push(loftRings('ear.' + (sign > 0 ? 'R' : 'L'), [
						{ center: [sign * hw * 0.94, L.head_base_y + L.head_height * 0.37, hd * 0.08], axis_u: [0, 1, 0], axis_v: [0, 0, sign], radius_u: L.head_height * 0.105, radius_v: hd * 0.16, weights: { head: 1 } },
						{ center: [sign * hw * 1.17, L.head_base_y + L.head_height * 0.38, hd * 0.07], axis_u: [0, 1, 0], axis_v: [0, 0, sign], radius_u: L.head_height * 0.11, radius_v: hd * 0.14, weights: { head: 1 } },
						{ center: [sign * hw * 1.23, L.head_base_y + L.head_height * 0.38, hd * 0.07], axis_u: [0, 1, 0], axis_v: [0, 0, sign], radius_u: L.head_height * 0.065, radius_v: hd * 0.09, weights: { head: 1 } },
					], 8));
				}
			}
			meshes.push(head);
		}
		return { bones, meshes };
	}
}
