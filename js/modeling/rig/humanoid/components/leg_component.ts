import { BoneSpec, BuildContext, ComponentOutput, HumanoidComponent, MeshSpec, Side } from '../humanoid_types';
import { buildChainLoft, Station } from '../chain_loft';
import { ChainBone } from '../loft';
import { Vec3, distance } from '../vec';
import { loftSettingsFor } from './component_utils';

export class LegComponent implements HumanoidComponent {
	readonly id: string;
	private readonly x_sign: number;

	constructor(private readonly side: Side) {
		this.id = 'leg.' + side;
		this.x_sign = side == 'R' ? 1 : -1;
	}

	build(context: BuildContext): ComponentOutput {
		const { params, landmarks: L } = context;
		const sx: number = this.x_sign;
		const suffix: string = '.' + this.side;
		const H: number = L.height;
		const x: number = sx * L.hip_x;

		const hip: Vec3 = [x, L.hip_y, 0];
		const knee: Vec3 = [x, L.knee_y, -0.012 * H];
		const ankle: Vec3 = [x, L.ankle_y, 0];
		const ball: Vec3 = [x, 0.02 * H, -0.47 * L.foot_length];
		const tip: Vec3 = [x, 0.014 * H, -0.75 * L.foot_length];

		const bones: BoneSpec[] = [
			{ id: 'upper_leg' + suffix, parent: L.spine_ids[0], head: hip, tail: knee, connected: false },
			{ id: 'lower_leg' + suffix, parent: 'upper_leg' + suffix, head: knee, tail: ankle, connected: true },
		];
		if (params.toes) {
			bones.push({ id: 'foot' + suffix, parent: 'lower_leg' + suffix, head: ankle, tail: ball, connected: true });
			bones.push({ id: 'toes' + suffix, parent: 'foot' + suffix, head: ball, tail: tip, connected: true });
		} else {
			bones.push({ id: 'foot' + suffix, parent: 'lower_leg' + suffix, head: ankle, tail: tip, connected: true });
		}

		const meshes: MeshSpec[] = [];
		if (L.mesh_enabled) {
			const settings = loftSettingsFor(context);
			const thick: number = params.limb_thickness;
			const thigh: number = 0.058 * H * thick;
			const knee_r: number = 0.04 * H * thick;
			const ankle_r: number = 0.026 * H * thick;
			const leg_chain: ChainBone[] = [
				{ id: 'upper_leg' + suffix, head: hip, tail: knee },
				{ id: 'lower_leg' + suffix, head: knee, tail: ankle },
			];
			const stations: Station[] = settings.rigid
				? [
					{ t: -0.04, ru: thigh * 1.05, rv: thigh * 1.05 },
					{ t: 0.5, ru: knee_r * 1.1, rv: knee_r * 1.1 },
					{ t: 1, ru: ankle_r * 1.15, rv: ankle_r * 1.15 },
				]
				: [
					{ t: -0.05, ru: thigh * 1.05, rv: thigh * 1.05 },
					{ t: 0.15, ru: thigh, rv: thigh },
					{ t: 0.5, ru: knee_r, rv: knee_r },
					{ t: 0.66, ru: knee_r * 1.04, rv: knee_r * 1.04 },
					{ t: 1, ru: ankle_r, rv: ankle_r },
				];
			meshes.push(buildChainLoft({ name: 'leg' + suffix, bones: leg_chain, stations, up_hint: [1, 0, 0] }, settings));

			// foot: tapered box/loft along the foot chain, resting on the ground plane
			const foot_chain: ChainBone[] = bones.filter((b: BoneSpec) => b.id.startsWith('foot') || b.id.startsWith('toes')).map((b: BoneSpec) => ({ id: b.id, head: b.head, tail: b.tail }));
			const total: number = foot_chain.reduce((sum: number, b: ChainBone) => sum + distance(b.head, b.tail), 0);
			const ball_t: number = params.toes ? distance(ankle, ball) / total : 0.62;
			const heel_t: number = -0.25 * L.foot_length / total;
			const center_y = (t: number): number => {
				const s: number = t * total;
				const ab: number = params.toes ? distance(ankle, ball) : total * ball_t;
				const slope: number = (L.ankle_y - 0.02 * H) / ab;
				if (s <= ab) return L.ankle_y - s * slope;
				const tail_slope: number = (0.02 * H - 0.014 * H) / Math.max(1e-6, total - ab);
				return 0.02 * H - (s - ab) * tail_slope;
			};
			const fw: number = L.foot_width;
			// the foot axis points forward (-z), so u is the vertical and v the lateral half extent
			const foot_stations: Station[] = [
				{ t: heel_t, ru: center_y(heel_t) * 0.85, rv: fw * 0.8 },
				{ t: 0, ru: center_y(0) * 0.9, rv: fw * 0.85 },
				{ t: ball_t, ru: center_y(ball_t) * 0.92, rv: fw },
				{ t: 1.0, ru: center_y(1.0) * 0.9, rv: fw * 0.75 },
			];
			meshes.push(buildChainLoft({ name: 'foot' + suffix, bones: foot_chain, stations: foot_stations, up_hint: [1, 0, 0] }, settings));
		}
		return { bones, meshes };
	}
}
