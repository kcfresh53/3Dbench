import { Blockbench } from '../../../api';
import { IKRigController } from './ik_rig_controller';
import { getRigData } from './ik_rig_project';
import { createRigFromScene, deleteRig, redetectBones, SetupResult } from './ik_rig_setup';
import { bakeRigIntoAnimation, BakeOptions, DEFAULT_BAKE_OPTIONS } from './ik_rig_bake';
import { importAnimationsFromGlb } from './ik_rig_import';
import type { IKRigProjectData } from './ik_rig_data';

function hasRig(): boolean {
	return !!getRigData();
}

function report(result: SetupResult): void {
	if (result.ok) Blockbench.showQuickMessage(result.message, 2500);
	else Blockbench.showMessageBox({ title: 'IK Rig', message: result.message });
}

/** Called by actions after the rig changed so the panel and preview refresh */
function refresh(): void {
	IKRigController.forProject()?.invalidate();
	Blockbench.dispatchEvent('update_ik_rig' as never, {} as never);
	if (Modes.animate) Animator.preview();
}

BARS.defineActions(function() {
	new Action('create_ik_rig', {
		icon: 'accessibility_new',
		category: 'animation',
		condition: () => Format.animation_mode && !hasRig(),
		click() {
			report(createRigFromScene());
			Blockbench.dispatchEvent('update_ik_rig' as never, {} as never);
		},
	});

	new Action('toggle_ik_rig', {
		icon: 'toggle_on',
		category: 'animation',
		condition: () => Format.animation_mode && hasRig(),
		click() {
			const data: IKRigProjectData | null = getRigData();
			if (!data) return;
			Undo.initEdit({ ik_rig: true });
			data.enabled = !data.enabled;
			Undo.finishEdit('Toggle IK rig');
			refresh();
		},
	});

	new Action('delete_ik_rig', {
		icon: 'delete',
		category: 'animation',
		condition: () => Format.animation_mode && hasRig(),
		click() {
			deleteRig();
			Blockbench.dispatchEvent('update_ik_rig' as never, {} as never);
		},
	});

	new Action('redetect_ik_rig_bones', {
		icon: 'sync',
		category: 'animation',
		condition: () => Format.animation_mode && hasRig(),
		click() {
			report(redetectBones());
			Blockbench.dispatchEvent('update_ik_rig' as never, {} as never);
		},
	});

	const bake_dialog: Dialog = new Dialog({
		id: 'bake_ik_rig',
		title: 'action.bake_ik_rig',
		form: {
			rotation_tolerance: { label: 'Rotation tolerance (degrees)', type: 'number', value: DEFAULT_BAKE_OPTIONS.rotation_tolerance, min: 0.001, max: 5, step: 0.01 },
			position_tolerance: { label: 'Position tolerance (fraction of body height)', type: 'number', value: DEFAULT_BAKE_OPTIONS.position_tolerance, min: 0.00001, max: 0.05, step: 0.0001 },
			disable_after: { label: 'Turn the rig off afterwards', type: 'checkbox', value: DEFAULT_BAKE_OPTIONS.disable_after },
		},
		onConfirm(result: BakeOptions) {
			const animation: BBAnimation | null = BBAnimation.selected;
			if (!animation) return;
			const created: number = bakeRigIntoAnimation(animation, result);
			if (created < 0) Blockbench.showQuickMessage('Nothing to bake', 2000);
			else Blockbench.showQuickMessage(`Baked ${created} keyframes`, 2000);
			Blockbench.dispatchEvent('update_ik_rig' as never, {} as never);
		},
	});
	new Action('bake_ik_rig', {
		icon: 'precision_manufacturing',
		category: 'animation',
		condition: () => Modes.animate && hasRig() && !!BBAnimation.selected,
		click() {
			bake_dialog.show();
		},
	});

	new Action('import_retarget_animations', {
		icon: 'directions_run',
		category: 'animation',
		condition: () => Modes.animate && hasRig(),
		click() {
			importAnimationsFromGlb();
		},
	});

	new Action('ik_rig_ground_from_selection', {
		icon: 'terrain',
		category: 'animation',
		condition: () => Format.animation_mode && hasRig(),
		click() {
			const data: IKRigProjectData | null = getRigData();
			if (!data) return;
			const uuids: string[] = Outliner.selected.map((element: OutlinerElement): string => element.uuid);
			if (!uuids.length) {
				Blockbench.showQuickMessage('Select the elements that form the ground first', 2000);
				return;
			}
			Undo.initEdit({ ik_rig: true });
			data.ground.mode = 'objects';
			data.ground.objects = uuids;
			Undo.finishEdit('Set IK ground');
			refresh();
		},
	});

	new Action('ik_rig_ground_flat', {
		icon: 'horizontal_rule',
		category: 'animation',
		condition: () => Format.animation_mode && hasRig(),
		click() {
			const data: IKRigProjectData | null = getRigData();
			if (!data) return;
			Undo.initEdit({ ik_rig: true });
			data.ground.mode = 'flat';
			data.ground.objects = [];
			Undo.finishEdit('Set flat IK ground');
			refresh();
		},
	});
});

declare global {
	interface BarItemRegistry {
		create_ik_rig: Action
		toggle_ik_rig: Action
		delete_ik_rig: Action
		redetect_ik_rig_bones: Action
		bake_ik_rig: Action
		import_retarget_animations: Action
		ik_rig_ground_from_selection: Action
		ik_rig_ground_flat: Action
	}
	interface BlockbenchEventMap {
		update_ik_rig: {}
	}
}
