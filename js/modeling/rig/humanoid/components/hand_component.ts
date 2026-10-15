import { BoneSpec, BuildContext, ComponentOutput, HumanoidComponent, MeshSpec, Side } from '../humanoid_types';
import { buildChainLoft, LoftSettings, Station } from '../chain_loft';
import { ChainBone } from '../loft';
import { Vec3, add, normalize, scale, cross } from '../vec';
import { loftSettingsFor } from './component_utils';

interface FingerSpec {
	name: string
	/** Lateral offset of the finger base across the palm in units of palm half width, front (index) to back */
	lateral: number
	/** Total finger length relative to the hand length */
	length: number
	radius: number
	segments: number[]
}

const FINGERS: FingerSpec[] = [
	{ name: 'index', lateral: -0.78, length: 0.5, radius: 0.043, segments: [0.45, 0.30, 0.25] },
	{ name: 'middle', lateral: -0.26, length: 0.55, radius: 0.045, segments: [0.45, 0.30, 0.25] },
	{ name: 'ring', lateral: 0.26, length: 0.5, radius: 0.042, segments: [0.45, 0.30, 0.25] },
	{ name: 'pinky', lateral: 0.78, length: 0.4, radius: 0.036, segments: [0.45, 0.30, 0.25] },
];

/** Hand with palm and optionally five fingers. Attached at the wrist of an arm. */
export class HandComponent implements HumanoidComponent {
	readonly id: string;

	constructor(
		private readonly side: Side,
		private readonly wrist: Vec3,
		/** Direction of the forearm, continued by the hand */
		private readonly direction: Vec3,
		private readonly parent_id: string
	) {
		this.id = 'hand.' + side;
	}

	build(context: BuildContext): ComponentOutput {
		const { params, landmarks: L } = context;
		const suffix: string = '.' + this.side;
		const hand_length: number = 0.105 * L.height * params.hand_scale;
		const full: boolean = params.fingers == 'full';
		const palm_length: number = full ? 0.45 * hand_length : hand_length;
		const d: Vec3 = normalize(this.direction);
		const palm_end: Vec3 = add(this.wrist, scale(d, palm_length));
		const bones: BoneSpec[] = [
			{ id: 'hand' + suffix, parent: this.parent_id, head: this.wrist, tail: palm_end, connected: true },
		];
		const meshes: MeshSpec[] = [];
		const settings: LoftSettings = loftSettingsFor(context);
		const palm_half_width: number = (full ? 0.2 : 0.29) * hand_length;

		if (L.mesh_enabled) {
			const stations: Station[] = full
				? [
					{ t: -0.08, ru: 0.065 * hand_length, rv: 0.11 * hand_length },
					{ t: 0.5, ru: 0.085 * hand_length, rv: palm_half_width },
					{ t: 1.0, ru: 0.07 * hand_length, rv: palm_half_width * 0.95 },
				]
				: [
					{ t: -0.05, ru: 0.16 * hand_length, rv: 0.17 * hand_length },
					{ t: 0.35, ru: 0.22 * hand_length, rv: palm_half_width },
					{ t: 0.8, ru: 0.2 * hand_length, rv: palm_half_width * 0.9 },
					{ t: 1.0, ru: 0.14 * hand_length, rv: palm_half_width * 0.65 },
				];
			if (full && !settings.rigid) {
				// Four open knuckle sockets share the palm surface; each finger is bridged later.
				const mesh: MeshSpec = { name: 'hand' + suffix, vertices: [], vertex_weights: [], faces: [] };
				const normal = normalize(cross([0, 0, 1], d));
				const rows = [{ t: -0.08, width: 0.11, depth: 0.1 }, { t: 0.45, width: 0.2, depth: 0.085 }, { t: 1, width: 0.2, depth: 0.07 }];
				for (const row of rows) {
					const center = add(this.wrist, scale(d, palm_length * row.t));
					for (let i = 0; i < 10; i++) {
						const column = i < 5 ? i : 9 - i;
						mesh.vertices.push(add(center, add(scale(normal, (i < 5 ? 1 : -1) * row.depth * hand_length), [0, 0, (column / 2 - 1) * row.width * hand_length])));
						mesh.vertex_weights.push({ ['hand' + suffix]: 1 });
					}
				}
				for (let row = 0; row < 2; row++) for (let i = 0; i < 10; i++) mesh.faces.push([row * 10 + i, row * 10 + (i + 1) % 10, (row + 1) * 10 + (i + 1) % 10, (row + 1) * 10 + i]);
				mesh.vertices.push(add(this.wrist, scale(d, -0.08 * palm_length)), palm_end);
				mesh.vertex_weights.push({ ['hand' + suffix]: 1 }, { ['hand' + suffix]: 1 });
				for (let i = 0; i < 10; i++) mesh.faces.push([i, (i + 1) % 10, 30]);
				for (let i = 0; i < 4; i++) mesh.faces.push([20 + i, 21 + i, 28 - i, 29 - i]);
				meshes.push(mesh);
			} else {
			meshes.push(buildChainLoft({
				name: 'hand' + suffix,
				bones: [{ id: 'hand' + suffix, head: this.wrist, tail: palm_end }],
				stations,
				up_hint: [0, 0, 1],
			}, settings));
			}
		}

		{
			const finger_settings: LoftSettings = { ...settings, sides: settings.sides == 4 ? 4 : 6 };
			const lateral_axis: Vec3 = [0, 0, 1];

			for (const finger of full ? FINGERS : []) {
				const base: Vec3 = add(palm_end, scale(lateral_axis, finger.lateral * palm_half_width));
				this.addFingerChain(bones, meshes, context, finger_settings, finger.name, suffix, base, d, finger.length * hand_length, finger.segments, finger.radius * hand_length, 'hand' + suffix);
			}
			// thumb: starts near the wrist on the front side of the palm, angled forward
			const thumb_base: Vec3 = add(add(this.wrist, scale(d, palm_length * (full ? 0.18 : 0.25))), scale(lateral_axis, -palm_half_width * 0.85));
			const thumb_direction: Vec3 = normalize(add(scale(d, 0.65), scale(lateral_axis, -0.75)));
			this.addFingerChain(bones, meshes, context, finger_settings, 'thumb', suffix, thumb_base, thumb_direction, hand_length * (full ? 0.5 : 0.48), [0.4, 0.33, 0.27], (full ? 0.05 : 0.1) * hand_length, 'hand' + suffix);
		}
		return { bones, meshes };
	}

	private addFingerChain(
		bones: BoneSpec[], meshes: MeshSpec[], context: BuildContext, settings: LoftSettings,
		name: string, suffix: string, base: Vec3, direction: Vec3, total_length: number,
		segments: number[], radius: number, parent_id: string
	): void {
		const chain: ChainBone[] = [];
		let head: Vec3 = base;
		segments.forEach((fraction: number, i: number) => {
			const tail: Vec3 = add(head, scale(direction, total_length * fraction));
			const id: string = name + '_' + (i + 1) + suffix;
			bones.push({ id, parent: i == 0 ? parent_id : name + '_' + i + suffix, head, tail, connected: i > 0 });
			chain.push({ id, head, tail });
			head = tail;
		});
		if (!context.landmarks.mesh_enabled) return;
		meshes.push(buildChainLoft({
			name: name + suffix,
			bones: chain,
			stations: [
				{ t: -0.02, ru: radius, rv: radius },
				{ t: 0.5, ru: radius * 0.88, rv: radius * 0.88 },
				{ t: 1.0, ru: radius * 0.7, rv: radius * 0.7 },
				{ t: 1.03, ru: radius * 0.55, rv: radius * 0.55 },
			],
			up_hint: [0, 0, 1],
		}, settings));
	}
}
