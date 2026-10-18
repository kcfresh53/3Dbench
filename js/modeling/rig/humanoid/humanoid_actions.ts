import { Armature } from '../../../outliner/types/armature';
import { ArmatureBone } from '../../../outliner/types/armature_bone';
import { BoneSpec, ComponentOutput, DEFAULT_HUMANOID, HUMANOID_PRESETS, HumanoidParams, MeshSpec } from './humanoid_types';
import { buildHumanoid } from './humanoid_builder';
import { buildFromTemplate, HumanoidTemplate, loadHumanoidTemplate } from './template';
import { buildModularHumanoid, DEFAULT_MODULAR, ModularOptions } from './modular';
import { createHumanoidPreview } from './preview';
import { boneName } from './bone_names';
import { distance, Vec3 } from './vec';
import { THREE } from '../../../lib/libs';
import { unwrapMeshes } from '../../mesh/unwrap/mesh_unwrap';
import type { FormResultValue } from '../../../interface/form';
import { DEFAULT_UNWRAP_OPTIONS, UnwrapOptions } from '../../mesh/unwrap/types';

type HumanoidForm = HumanoidParams & ModularOptions & { preset: string };
const isModular = (f: HumanoidForm): boolean => !!HUMANOID_PRESETS[f.preset]?.template?.startsWith('bodiez_');

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

/** Shared by the isolated preview and final scene creation. */
function buildCharacter(params: HumanoidParams, template?: HumanoidTemplate, options: ModularOptions = DEFAULT_MODULAR): ComponentOutput {
	return template?.customization ? buildModularHumanoid(template, params.height, params.generate_mesh, options)
		: template ? buildFromTemplate(template, params.height, params.generate_mesh) : buildHumanoid(params);
}

/** Creates the armature, bones and meshes for a humanoid in the current project. Returns the armature. */
export function createHumanoidInScene(params: HumanoidParams, template?: HumanoidTemplate, options: ModularOptions = DEFAULT_MODULAR): Armature {
	const output = buildCharacter(params, template, options);
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

function showHumanoidDialog() {
	const owner = Project;
	const form: Record<string, any> = {
		preset: { label: 'dialog.create_humanoid.preset', type: 'select', value: 'male', options: PRESET_OPTIONS },
		head_size: { label: 'Head size', type: 'range', editable_range_label: true, value: 1, min: 0.5, max: 2, step: 0.01, condition: isModular },
		body_type: { label: 'Body type', type: 'range', editable_range_label: true, value: 1, min: 0, max: 3, step: 0.01, description: 'Thin (0) → Regular (1) → Muscular (2) → Heavy (3). Blend freely between neighboring types.', condition: isModular },
		body_size: { label: 'Body size', type: 'range', editable_range_label: true, value: 1, min: 0.6, max: 1.6, step: 0.01, condition: isModular },
		shoulder_size: { label: 'Shoulders', type: 'range', editable_range_label: true, value: 1, min: 0.6, max: 1.6, step: 0.01, condition: isModular },
		breast_size: { label: 'Breast size', type: 'range', editable_range_label: true, value: 0, min: -1, max: 1, step: 0.01, condition: (f: HumanoidForm) => isModular(f) && f.preset === 'female' },
		shortness: { label: 'Short proportions', type: 'range', editable_range_label: true, value: 0, min: 0, max: 1, step: 0.01, condition: isModular },
		hip_fullness: { label: 'Hips', type: 'range', editable_range_label: true, value: 0, min: 0, max: 1, step: 0.01, condition: isModular },
		arm_size: { label: 'Arm size', type: 'range', editable_range_label: true, value: 1, min: 0.6, max: 1.5, step: 0.01, condition: isModular },
		leg_size: { label: 'Leg size', type: 'range', editable_range_label: true, value: 1, min: 0.6, max: 1.5, step: 0.01, condition: isModular },
		include_ears: { label: 'Include ears', type: 'checkbox', value: true, condition: (f: HumanoidForm) => isModular(f) && f.generate_mesh },
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
		form[key].condition = (f: HumanoidForm) => (!HUMANOID_PRESETS[f.preset]?.template || (key === 'single_mesh' && isModular(f))) && (!previous || previous(f));
	}
	form._modular_note = { type: 'info', text: 'Body type blends Thin (0), Regular (1), Muscular (2), and Heavy (3). Combine the sliders freely; 1 is neutral for size controls. Short proportions shorten the torso and legs relative to the head. Height sets the final overall height.', condition: isModular };
	form._template_note = { type: 'info', text: 'Original geometry, UVs, skin weights and A-pose, without textures. Height scales the entire model uniformly.', condition: (f: HumanoidForm) => !!HUMANOID_PRESETS[f.preset]?.template && !isModular(f) };
	let last_preset = 'male', active = false, revision = 0, confirming = false;
	let timer: ReturnType<typeof setTimeout>;
	let pendingPreview: HumanoidForm;
	let preview: ReturnType<typeof createHumanoidPreview>;
	let status: HTMLElement;
	const templates = new Map<string, Promise<HumanoidTemplate>>();
	const readForm = (): HumanoidForm => ({ ...DEFAULT_HUMANOID, ...DEFAULT_MODULAR, preset: 'male', ...dialog.getFormResult() });
	function getTemplate(result: HumanoidForm): Promise<HumanoidTemplate | undefined> {
		const id = HUMANOID_PRESETS[result.preset]?.template;
		if (!id) return Promise.resolve(undefined);
		if (!templates.has(id)) templates.set(id, loadHumanoidTemplate(id).catch(error => { templates.delete(id); throw error; }));
		return templates.get(id)!;
	}
	function setStatus(text: string, error = false) {
		if (!status) return;
		status.textContent = text;
		status.classList.toggle('humanoid_error', error);
	}
	function refresh(result: HumanoidForm, delay = 60) {
		if (!active) return;
		pendingPreview = result;
		++revision;
		setStatus('Updating preview…');
		// Throttle instead of waiting for the drag to stop: keep rendering while a slider moves.
		if (timer !== undefined) return;
		timer = setTimeout(async () => {
			timer = undefined;
			const result = pendingPreview, request = revision;
			try {
				const template = await getTemplate(result);
				if (!active || request !== revision) return;
				const params = { ...DEFAULT_HUMANOID, ...result };
				const output = buildCharacter(params, template, { ...DEFAULT_MODULAR, ...result });
				preview?.update(output, !template && params.style === 'blocky');
				const vertices = output.meshes.reduce((n, mesh) => n + mesh.vertices.length, 0);
				const triangles = output.meshes.reduce((n, mesh) => n + mesh.faces.reduce((n, face) => n + face.length - 2, 0), 0);
				setStatus(`${vertices.toLocaleString()} vertices · ${triangles.toLocaleString()} triangles · ${output.bones.length} bones${preview ? '' : ' · 3D preview unavailable'}`);
			} catch (error) {
				if (!active || request !== revision) return;
				preview?.clear();
				setStatus(error instanceof Error ? error.message : 'Could not preview this character.', true);
			}
		}, delay);
	}
	function cleanup() {
		active = false; ++revision; clearTimeout(timer);
		preview?.dispose(); preview = undefined; templates.clear();
	}
	const dialog: Dialog = new Dialog({
		id: 'create_humanoid',
		title: 'action.create_humanoid',
		width: 1060,
		buttons: ['Add Humanoid', 'dialog.cancel'],
		part_order: ['component', 'form'],
		form,
		component: {
			template: `<div class="humanoid_view"><div class="humanoid_heading">LIVE CHARACTER PREVIEW</div><canvas aria-label="Humanoid preview"></canvas><p class="humanoid_stats" role="status" aria-live="polite"></p><p class="humanoid_hint">Drag to orbit · Scroll to zoom · Double-click to reset</p></div>`,
		},
		onOpen() {
			active = true;
			status = dialog.object.querySelector('.humanoid_stats');
			try { preview = createHumanoidPreview(dialog.object.querySelector('canvas')); }
			catch (error) { console.error('Humanoid preview unavailable', error); }
			refresh(readForm(), 0);
		},
		onFormChange(result: Record<string, FormResultValue>) {
			const preset_key = result.preset as string;
			if (preset_key !== last_preset) {
				last_preset = preset_key;
				const preset = HUMANOID_PRESETS[preset_key];
				if (!preset) return;
				const values = { ...DEFAULT_HUMANOID, ...preset.values };
				const update: Record<string, any> = { ...DEFAULT_MODULAR };
				for (const [key] of PROPORTION_FIELDS) update[key] = values[key];
				for (const key of ['style', 'fingers', 'toes', 'spine_bones']) update[key] = values[key];
				dialog.setFormValues(update, false);
			}
			refresh(readForm());
		},
		onConfirm(result: HumanoidForm) {
			if (confirming) return false;
			confirming = true;
			void (async () => {
				try {
					const template = await getTemplate(result);
					if (!active) return;
					if (Project !== owner) throw new Error('The original project is no longer open. Reopen Create Humanoid in the current project.');
					createHumanoidInScene({ ...DEFAULT_HUMANOID, ...result }, template, { ...DEFAULT_MODULAR, ...result });
					dialog.close(dialog.cancelIndex);
				} catch (error) {
					if (active) setStatus(error instanceof Error ? error.message : 'Could not create this character.', true);
				} finally { confirming = false; }
			})();
			return false;
		},
		onClose() {
			cleanup();
			queueMicrotask(() => dialog.delete());
		},
	});
	dialog.show();
}

BARS.defineActions(function() {
	new Action('create_humanoid', {
		icon: 'accessibility_new',
		category: 'edit',
		condition: () => Modes.edit && !!Format.armature_rig && !!Format.meshes,
		click() {
			showHumanoidDialog();
		},
	});
});

declare global {
	interface BarItemRegistry {
		create_humanoid: Action
	}
}
