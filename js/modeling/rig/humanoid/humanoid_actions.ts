import { Armature } from '../../../outliner/types/armature';
import { ArmatureBone } from '../../../outliner/types/armature_bone';
import { BoneSpec, DEFAULT_HUMANOID, HUMANOID_PRESETS, HumanoidParams, MeshSpec } from './humanoid_types';
import { buildHumanoid } from './humanoid_builder';
import { buildFromTemplate, HumanoidTemplate, loadHumanoidTemplate } from './template';
import { boneName } from './bone_names';
import { distance, Vec3 } from './vec';
import { THREE } from '../../../lib/libs';
import { unwrapMeshes } from '../../mesh/unwrap/mesh_unwrap';
import type { FormResultValue } from '../../../interface/form';
import { DEFAULT_UNWRAP_OPTIONS, UnwrapOptions } from '../../mesh/unwrap/types';

type HumanoidForm = HumanoidParams & { preset: string };

const PRESET_OPTIONS: Record<string, string> = {};
for (const key in HUMANOID_PRESETS) PRESET_OPTIONS[key] = HUMANOID_PRESETS[key].label;

/** Proportion sliders: key and the allowed range */
const PROPORTION_FIELDS: [keyof HumanoidParams, number, number][] = [
	['head_scale', 0.5, 3],
	['head_width', 0.7, 1.4],
	['jaw_width', 0.6, 1.3],
	['waist_width', 0.6, 1.4],
	['chest_shape', 0, 1],
	['neck_length', 0.2, 2],
	['torso_length', 0.5, 1.5],
	['leg_length', 0.4, 1.5],
	['arm_length', 0.4, 1.5],
	['shoulder_width', 0.5, 2],
	['hip_width', 0.5, 2],
	['body_depth', 0.5, 2],
	['limb_thickness', 0.4, 2],
	['hand_scale', 0.5, 2],
	['foot_scale', 0.5, 2],
];

/** World rotation that points the +Y axis of a bone from its head towards its tail */
function boneWorldQuaternion(head: Vec3, tail: Vec3): THREE.Quaternion {
	const direction: THREE.Vector3 = new THREE.Vector3(tail[0] - head[0], tail[1] - head[1], tail[2] - head[2]).normalize();
	const quaternion: THREE.Quaternion = new THREE.Quaternion();
	if (direction.y < -0.9999999) {
		quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
	} else {
		quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
	}
	return quaternion;
}

/** Creates the armature, bones and meshes for a humanoid in the current project. Returns the armature. */
export function createHumanoidInScene(params: HumanoidParams, template?: HumanoidTemplate): Armature {
	const output = template ? buildFromTemplate(template, params.height, params.generate_mesh) : buildHumanoid(params);
	const elements: OutlinerElement[] = [];
	Undo.initEdit({ outliner: true, elements: [], selection: true });
	unselectAllElements();

	const armature: Armature = new Armature({ name: template?.name ?? 'humanoid' });
	armature.addTo(Outliner.ROOT);
	armature.isOpen = true;
	armature.createUniqueName();
	armature.init();
	elements.push(armature);

	const bone_by_id: Map<string, ArmatureBone> = new Map();
	const spec_by_id: Map<string, BoneSpec> = new Map();
	const world_rotation: Map<string, THREE.Quaternion> = new Map();
	for (const spec of output.bones) {
		spec_by_id.set(spec.id, spec);
		const parent_spec: BoneSpec | undefined = spec.parent ? spec_by_id.get(spec.parent) : undefined;
		const own_rotation: THREE.Quaternion = boneWorldQuaternion(spec.head, spec.tail);
		world_rotation.set(spec.id, own_rotation);

		// bones are oriented along their length (+Y). Position and rotation are relative to the parent bone.
		const parent_inverse: THREE.Quaternion = (parent_spec ? world_rotation.get(parent_spec.id) as THREE.Quaternion : new THREE.Quaternion()).clone().invert();
		const offset: THREE.Vector3 = new THREE.Vector3(
			spec.head[0] - (parent_spec ? parent_spec.head[0] : 0),
			spec.head[1] - (parent_spec ? parent_spec.head[1] : 0),
			spec.head[2] - (parent_spec ? parent_spec.head[2] : 0),
		).applyQuaternion(parent_inverse);
		const euler: THREE.Euler = new THREE.Euler().setFromQuaternion(parent_inverse.clone().multiply(own_rotation), Format.euler_order);
		const bone_length: number = Math.max(0.001, distance(spec.head, spec.tail));
		const bone: ArmatureBone = new ArmatureBone({
			name: boneName(spec.id, params.naming),
			origin: offset.toArray() as ArrayVector3,
			rotation: [euler.x, euler.y, euler.z].map((angle: number) => Math.roundTo(angle * 180 / Math.PI, 4)) as ArrayVector3,
			length: bone_length,
			width: Math.min(2.4, Math.max(0.5, bone_length * 0.22)),
			connected: spec.connected,
		});
		const parent: ArmatureBone | Armature = (spec.parent ? bone_by_id.get(spec.parent) : undefined) ?? armature;
		bone.addTo(parent);
		bone.isOpen = true;
		bone.init();
		bone_by_id.set(spec.id, bone);
		elements.push(bone);
	}

	const meshes: Mesh[] = [];
	output.meshes.forEach((spec: MeshSpec) => {
		if (!spec.faces.length) return;
		const mesh: Mesh = new Mesh({ name: spec.name, vertices: {}, shading: !template && params.style === 'blocky' ? 'flat' : 'smooth' });
		mesh.addTo(armature);
		const keys: string[] = [];
		for (const vertex of spec.vertices) keys.push(...mesh.addVertices(vertex));
		spec.faces.forEach((face, fi) => {
			const uv: Record<string, [number, number]> = {};
			if (spec.face_uvs) face.forEach((v, corner) => {
				const [u, vCoord] = spec.face_uvs![fi][corner];
				uv[keys[v]] = [u * Project.texture_width, (1 - vCoord) * Project.texture_height];
			});
			mesh.addFaces(new MeshFace(mesh, {
				vertices: face.map(i => keys[i]), uv,
				texture: false,
			}));
		});
		mesh.init();
		spec.vertex_weights.forEach((weights: Record<string, number>, i: number) => {
			for (const id in weights) {
				bone_by_id.get(id)?.setVertexWeight(mesh, keys[i], weights[id]);
			}
		});
		meshes.push(mesh);
		elements.push(mesh);
	});

	if (!template && params.auto_uv && meshes.length) {
		const options: UnwrapOptions = {
			...DEFAULT_UNWRAP_OPTIONS,
			uv_width: Project.texture_width,
			uv_height: Project.texture_height,
		};
		unwrapMeshes(meshes, options, false);
		meshes.forEach((mesh: Mesh) => Mesh.preview_controller.updateUV(mesh));
	}

	armature.select();
	Undo.finishEdit('Create humanoid', { outliner: true, elements, selection: true });
	Canvas.updateAllBones();
	Canvas.updateView({ elements: meshes, element_aspects: { geometry: true, uv: true } });
	return armature;
}

BARS.defineActions(function() {
	const form: Record<string, any> = {
		preset: { label: 'dialog.create_humanoid.preset', type: 'select', value: 'male', options: PRESET_OPTIONS },
		height: { label: 'dialog.create_humanoid.height', type: 'number', value: DEFAULT_HUMANOID.height, min: 1, step: 1 },
		style: {
			label: 'dialog.create_humanoid.style', type: 'select', value: DEFAULT_HUMANOID.style,
			options: { blocky: 'dialog.create_humanoid.style.blocky', low_poly: 'dialog.create_humanoid.style.low_poly', smooth: 'dialog.create_humanoid.style.smooth' },
		},
		arm_pose: {
			label: 'dialog.create_humanoid.arm_pose', type: 'select', value: DEFAULT_HUMANOID.arm_pose,
			options: { t_pose: 'dialog.create_humanoid.arm_pose.t_pose', a_pose: 'dialog.create_humanoid.arm_pose.a_pose', relaxed: 'dialog.create_humanoid.arm_pose.relaxed' },
		},
		fingers: {
			label: 'dialog.create_humanoid.fingers', type: 'select', value: DEFAULT_HUMANOID.fingers,
			options: { none: 'dialog.create_humanoid.fingers.none', full: 'dialog.create_humanoid.fingers.full' },
		},
		toes: { label: 'dialog.create_humanoid.toes', type: 'checkbox', value: DEFAULT_HUMANOID.toes },
		spine_bones: { label: 'dialog.create_humanoid.spine_bones', type: 'number', value: DEFAULT_HUMANOID.spine_bones, min: 1, max: 3, step: 1, force_step: true },
		root_bone: { label: 'dialog.create_humanoid.root_bone', type: 'checkbox', value: DEFAULT_HUMANOID.root_bone },
		naming: {
			label: 'dialog.create_humanoid.naming', type: 'select', value: DEFAULT_HUMANOID.naming,
			options: { godot: 'Godot', unity: 'Unity', mixamo: 'Mixamo', simple: 'dialog.create_humanoid.naming.simple' },
		},
		generate_mesh: { label: 'dialog.create_humanoid.generate_mesh', type: 'checkbox', value: DEFAULT_HUMANOID.generate_mesh },
		single_mesh: { label: 'dialog.create_humanoid.single_mesh', type: 'checkbox', value: DEFAULT_HUMANOID.single_mesh, condition: (f: HumanoidForm) => f.generate_mesh },
		auto_uv: { label: 'dialog.create_humanoid.auto_uv', type: 'checkbox', value: DEFAULT_HUMANOID.auto_uv, condition: (f: HumanoidForm) => f.generate_mesh },
		_proportions: '_',
	};
	for (const [key, min, max] of PROPORTION_FIELDS) {
		form[key] = { label: 'dialog.create_humanoid.' + key, type: 'num_slider', value: DEFAULT_HUMANOID[key], min, max, step: 0.05 };
	}

	// Exact templates retain their source proportions, pose, topology and UVs.
	// Hide controls that would suggest they can be changed without losing that exact match.
	for (const key of ['style', 'arm_pose', 'fingers', 'toes', 'spine_bones', 'root_bone', 'single_mesh', 'auto_uv', ...PROPORTION_FIELDS.map(([key]) => key)]) {
		const previous = form[key].condition;
		form[key].condition = (f: HumanoidForm) => !HUMANOID_PRESETS[f.preset]?.template && (!previous || previous(f));
	}
	form._male_note = { type: 'info', text: 'Adapted low-poly male mesh with a fitted rig, skin weights and preserved UVs. A-pose, without textures. Height scales the entire model uniformly.', condition: (f: HumanoidForm) => f.preset === 'male' };
	form._template_note = { type: 'info', text: 'Original geometry, UVs, skin weights and A-pose, without textures. Height scales the entire model uniformly.', condition: (f: HumanoidForm) => !!HUMANOID_PRESETS[f.preset]?.template && f.preset !== 'male' };
	let last_preset: string = 'male';
	const dialog: Dialog = new Dialog({
		id: 'create_humanoid',
		title: 'action.create_humanoid',
		width: 520,
		form,
		onFormChange(result: Record<string, FormResultValue>) {
			const preset_key: string = result.preset as string;
			if (preset_key == last_preset) return;
			last_preset = preset_key;
			const preset = HUMANOID_PRESETS[preset_key];
			if (!preset) return;
			// reset proportions to the defaults, then apply what the preset changes
			const values: Record<string, any> = { ...DEFAULT_HUMANOID, ...preset.values };
			const update: Record<string, any> = {};
			for (const [key] of PROPORTION_FIELDS) update[key] = values[key];
			for (const key of ['style', 'fingers', 'toes', 'spine_bones']) update[key] = values[key];
			dialog.setFormValues(update, false);
		},
		onConfirm(result: HumanoidForm) {
			void (async () => {
				const params: HumanoidParams = { ...DEFAULT_HUMANOID, ...result };
				const templateId = HUMANOID_PRESETS[result.preset]?.template;
				try {
					const template = templateId ? await loadHumanoidTemplate(templateId) : undefined;
					createHumanoidInScene(params, template);
				} catch (error) {
					console.error(error);
					Blockbench.showMessageBox({ title: 'Create Humanoid', message: error instanceof Error ? error.message : 'Could not load the local character template.' });
				}
			})();
		},
	});

	new Action('create_humanoid', {
		icon: 'accessibility_new',
		category: 'edit',
		condition: () => Modes.edit && !!Format.armature_rig && !!Format.meshes,
		click() {
			dialog.show();
		},
	});
});

declare global {
	interface BarItemRegistry {
		create_humanoid: Action
	}
}
