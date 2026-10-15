import { Armature } from '../../outliner/types/armature';
import { ArmatureBone } from '../../outliner/types/armature_bone';
import { limitWeights, smoothWeights } from './weight_tools';
import { flipNameOnAxis } from '../transform';
import type { FormResultValue } from '../../interface/form';

type ChainDirection = '+y' | '-y' | '+x' | '-x' | '+z' | '-z';

const DIRECTIONS: Record<ChainDirection, ArrayVector3> = {
	'+y': [0, 1, 0], '-y': [0, -1, 0], '+x': [1, 0, 0], '-x': [-1, 0, 0], '+z': [0, 0, 1], '-z': [0, 0, -1],
};

interface ChainForm {
	name: string
	count: number
	length: number
	taper: number
	direction: ChainDirection
}

interface SmoothForm {
	iterations: number
	strength: number
	max_influences: number
	selection_only: boolean
}

interface LimitForm {
	max_influences: number
	selection_only: boolean
}

function getTopSelectedBones(): ArmatureBone[] {
	return ArmatureBone.selected.filter((bone: ArmatureBone) => !(bone.parent instanceof ArmatureBone && bone.parent.selected));
}

/** Deep copy of a bone subtree. Weights are not copied. */
function copyBoneTree(bone: ArmatureBone): ArmatureBone {
	const copy: ArmatureBone = bone.getChildlessCopy(false);
	copy.vertex_weights = {};
	for (const child of bone.children) {
		if (child instanceof ArmatureBone) copyBoneTree(child).addTo(copy);
	}
	return copy;
}

function eachBone(root: ArmatureBone, callback: (bone: ArmatureBone) => void): void {
	callback(root);
	for (const child of root.children) {
		if (child instanceof ArmatureBone) eachBone(child, callback);
	}
}

function selectedMeshes(): Mesh[] {
	return Mesh.selected.filter((mesh: Mesh) => !!mesh.getArmature());
}

function targetVertices(mesh: Mesh, selection_only: boolean): string[] {
	if (selection_only) {
		const selected: string[] = mesh.getSelectedVertices();
		if (selected.length) return selected;
	}
	return Object.keys(mesh.vertices);
}

BARS.defineActions(function() {
	const chain_dialog: Dialog = new Dialog({
		id: 'create_bone_chain',
		title: 'action.create_bone_chain',
		form: {
			name: { label: 'dialog.create_bone_chain.name', type: 'text', value: 'chain' },
			count: { label: 'dialog.create_bone_chain.count', type: 'number', value: 4, min: 1, max: 64, step: 1, force_step: true },
			length: { label: 'dialog.create_bone_chain.length', type: 'number', value: 4, min: 0.1, step: 0.5 },
			taper: { label: 'dialog.create_bone_chain.taper', type: 'number', value: 0.9, min: 0.2, max: 1.5, step: 0.05 },
			direction: {
				label: 'dialog.create_bone_chain.direction', type: 'select', value: '+y',
				options: { '+y': '+Y', '-y': '-Y', '+x': '+X', '-x': '-X', '+z': '+Z', '-z': '-Z' },
			},
		},
		onConfirm(result: ChainForm) {
			const selected: OutlinerNode | undefined = Outliner.selected.last() ?? undefined;
			const parent: ArmatureBone | Armature | undefined = selected instanceof ArmatureBone || selected instanceof Armature ? selected : undefined;
			if (!parent) return;
			const created: ArmatureBone[] = [];
			Undo.initEdit({ outliner: true, elements: [], selection: true });
			const direction: ArrayVector3 = DIRECTIONS[result.direction];
			let previous: ArmatureBone | Armature = parent;
			let bone_length: number = result.length;
			let previous_length: number = 0;
			for (let i: number = 0; i < result.count; i++) {
				// the first bone starts at the tail of its parent, the others continue in the chain direction
				const origin: ArrayVector3 = i == 0
					? (parent instanceof ArmatureBone ? [0, parent.length, 0] : [0, 0, 0])
					: direction.map((v: number) => v * previous_length) as ArrayVector3;
				const bone: ArmatureBone = new ArmatureBone({
					name: result.name,
					origin,
					length: bone_length,
					width: Math.max(0.4, Math.min(2.4, bone_length * 0.25)),
					connected: true,
				});
				bone.addTo(previous);
				bone.isOpen = true;
				bone.createUniqueName();
				bone.init();
				created.push(bone);
				previous = bone;
				previous_length = bone_length;
				bone_length *= result.taper;
			}
			unselectAllElements();
			created.last().select();
			Undo.finishEdit('Create bone chain', { outliner: true, elements: created, selection: true });
		},
	});
	new Action('create_bone_chain', {
		icon: 'timeline',
		category: 'edit',
		condition: {
			modes: ['edit'],
			method: () => ArmatureBone.hasSelected() || Armature.hasSelected(),
		},
		click() {
			chain_dialog.show();
		},
	});

	new Action('mirror_bones', {
		icon: 'flip',
		category: 'edit',
		condition: { modes: ['edit'], method: () => ArmatureBone.hasSelected() },
		click() {
			const roots: ArmatureBone[] = getTopSelectedBones();
			const created: ArmatureBone[] = [];
			Undo.initEdit({ outliner: true, elements: [], selection: true });
			for (const root of roots) {
				const armature: Armature = root.getArmature();
				let target: ArmatureBone | Armature | typeof Outliner.ROOT = root.parent as ArmatureBone | Armature;
				if (root.parent instanceof ArmatureBone && armature) {
					// attach to the mirrored parent when there is one
					const probe: { name: string } = { name: root.parent.name };
					flipNameOnAxis(probe, 0);
					const counterpart: ArmatureBone | undefined = probe.name != root.parent.name
						? armature.getAllBones().find((b: ArmatureBone) => b !== root.parent && b.name == probe.name)
						: undefined;
					if (counterpart) target = counterpart;
				}
				const copy: ArmatureBone = copyBoneTree(root);
				copy.addTo(target);
				eachBone(copy, (bone: ArmatureBone) => {
					bone.init();
					bone.flip(0, 0);
					created.push(bone);
				});
			}
			unselectAllElements();
			created.forEach((bone: ArmatureBone) => bone.markAsSelected(false));
			updateSelection();
			Undo.finishEdit('Mirror bones', { outliner: true, elements: created, selection: true });
		},
	});

	const smooth_dialog: Dialog = new Dialog({
		id: 'smooth_vertex_weights',
		title: 'action.smooth_vertex_weights',
		form: {
			iterations: { label: 'dialog.smooth_vertex_weights.iterations', type: 'number', value: 3, min: 1, max: 50, step: 1, force_step: true },
			strength: { label: 'dialog.smooth_vertex_weights.strength', type: 'number', value: 0.5, min: 0.05, max: 1, step: 0.05 },
			max_influences: { label: 'dialog.calculate_vertex_weights.max_influences', type: 'number', value: 4, min: 1, max: 8, step: 1, force_step: true },
			selection_only: { label: 'dialog.smooth_vertex_weights.selection_only', type: 'checkbox', value: true },
		},
		onConfirm(result: SmoothForm) {
			const meshes: Mesh[] = selectedMeshes();
			const bones: ArmatureBone[] = [];
			meshes.forEach((mesh: Mesh) => bones.safePush(...mesh.getArmature().getAllBones()));
			Undo.initEdit({ elements: [...meshes, ...bones] });
			for (const mesh of meshes) {
				smoothWeights(mesh, mesh.getArmature().getAllBones(), targetVertices(mesh, result.selection_only), result.iterations, result.strength, result.max_influences);
				Canvas.updateView({ elements: [mesh], element_aspects: { geometry: true } });
			}
			Undo.finishEdit('Smooth vertex weights');
		},
	});
	new Action('smooth_vertex_weights', {
		icon: 'blur_on',
		category: 'edit',
		condition: { modes: ['edit'], method: () => selectedMeshes().length > 0 },
		click() {
			smooth_dialog.show();
		},
	});

	const limit_dialog: Dialog = new Dialog({
		id: 'limit_vertex_weights',
		title: 'action.limit_vertex_weights',
		form: {
			max_influences: { label: 'dialog.calculate_vertex_weights.max_influences', type: 'number', value: 4, min: 1, max: 8, step: 1, force_step: true },
			selection_only: { label: 'dialog.smooth_vertex_weights.selection_only', type: 'checkbox', value: false },
		},
		onConfirm(result: LimitForm) {
			const meshes: Mesh[] = selectedMeshes();
			const bones: ArmatureBone[] = [];
			meshes.forEach((mesh: Mesh) => bones.safePush(...mesh.getArmature().getAllBones()));
			Undo.initEdit({ elements: [...meshes, ...bones] });
			for (const mesh of meshes) {
				limitWeights(mesh, mesh.getArmature().getAllBones(), targetVertices(mesh, result.selection_only), result.max_influences);
				Canvas.updateView({ elements: [mesh], element_aspects: { geometry: true } });
			}
			Undo.finishEdit('Limit vertex weights');
		},
	});
	new Action('limit_vertex_weights', {
		icon: 'filter_list',
		category: 'edit',
		condition: { modes: ['edit'], method: () => selectedMeshes().length > 0 },
		click() {
			limit_dialog.show();
		},
	});
});

declare global {
	interface BarItemRegistry {
		create_bone_chain: Action
		mirror_bones: Action
		smooth_vertex_weights: Action
		limit_vertex_weights: Action
	}
}
