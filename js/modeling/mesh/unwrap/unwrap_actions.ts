import { DEFAULT_UNWRAP_OPTIONS, UnwrapMode, UnwrapOptions } from './types';
import { packExistingIslands, unwrapMeshes, UnwrapReport } from './mesh_unwrap';

interface UnwrapFormResult {
	mode: UnwrapMode
	angle_threshold: number
	max_stretch: number
	quality: number
	margin: number
	allow_rotation: boolean
	align_up: boolean
	texel_density: number
	selection_only: boolean
}

interface PackFormResult {
	margin: number
	allow_rotation: boolean
	keep_scale: boolean
	selection_only: boolean
}

function reportMessage(report: UnwrapReport, label: string): string {
	let text: string = tl('message.uv_unwrap.done', [label, report.island_count, report.face_count]);
	if (!report.density_kept) text += ' ' + tl('message.uv_unwrap.shrunk');
	return text;
}

function canRun(): boolean {
	return Modes.edit && Mesh.selected.length > 0;
}

BARS.defineActions(function() {
	const unwrap_dialog: Dialog = new Dialog({
		id: 'uv_smart_unwrap',
		title: 'action.uv_smart_unwrap',
		form: {
			mode: {
				label: 'dialog.uv_unwrap.mode', type: 'select', value: 'smart',
				options: {
					smart: 'dialog.uv_unwrap.mode.smart',
					seams: 'dialog.uv_unwrap.mode.seams',
				},
			},
			angle_threshold: {
				label: 'dialog.uv_unwrap.angle_threshold', type: 'number', value: DEFAULT_UNWRAP_OPTIONS.angle_threshold,
				min: 1, max: 180, step: 1, condition: (form: UnwrapFormResult) => form.mode == 'smart',
			},
			max_stretch: {
				label: 'dialog.uv_unwrap.max_stretch', type: 'number', value: DEFAULT_UNWRAP_OPTIONS.max_stretch,
				min: 1.05, max: 10, step: 0.05,
			},
			quality: {
				label: 'dialog.uv_unwrap.quality', type: 'number', value: DEFAULT_UNWRAP_OPTIONS.arap_iterations,
				min: 0, max: 30, step: 1, force_step: true,
			},
			margin: {
				label: 'dialog.uv_unwrap.margin', type: 'number', value: DEFAULT_UNWRAP_OPTIONS.margin,
				min: 0, max: 64, step: 1,
			},
			texel_density: {
				label: 'dialog.uv_unwrap.texel_density', type: 'number', value: 0, min: 0, step: 0.1,
			},
			allow_rotation: { label: 'dialog.uv_unwrap.allow_rotation', type: 'checkbox', value: true },
			align_up: { label: 'dialog.uv_unwrap.align_up', type: 'checkbox', value: true },
			selection_only: { label: 'dialog.uv_unwrap.selection_only', type: 'checkbox', value: true },
		},
		onConfirm(form: UnwrapFormResult) {
			const options: UnwrapOptions = {
				mode: form.mode,
				angle_threshold: form.angle_threshold,
				max_stretch: form.max_stretch,
				arap_iterations: form.quality,
				margin: form.margin,
				allow_rotation: form.allow_rotation,
				align_up: form.align_up,
				texel_density: form.texel_density,
				uv_width: UVEditor.getUVWidth(),
				uv_height: UVEditor.getUVHeight(),
			};
			const meshes: Mesh[] = Mesh.selected.slice();
			Undo.initEdit({ elements: meshes, uv_only: true });
			let report: UnwrapReport;
			try {
				report = unwrapMeshes(meshes, options, form.selection_only);
			} catch (error) {
				console.error(error);
				Undo.cancelEdit();
				Blockbench.showQuickMessage(tl('message.uv_unwrap.failed'), 2500);
				return;
			}
			meshes.forEach((mesh: Mesh) => Mesh.preview_controller.updateUV(mesh));
			UVEditor.loadData();
			Undo.finishEdit('Smart UV unwrap');
			Blockbench.showQuickMessage(reportMessage(report, tl('action.uv_smart_unwrap')), 2500);
		},
	});
	new Action('uv_smart_unwrap', {
		icon: 'auto_awesome_mosaic',
		category: 'uv',
		condition: canRun,
		click() {
			unwrap_dialog.show();
		},
	});

	const pack_dialog: Dialog = new Dialog({
		id: 'uv_pack_islands',
		title: 'action.uv_pack_islands',
		form: {
			margin: { label: 'dialog.uv_unwrap.margin', type: 'number', value: DEFAULT_UNWRAP_OPTIONS.margin, min: 0, max: 64, step: 1 },
			allow_rotation: { label: 'dialog.uv_unwrap.allow_rotation', type: 'checkbox', value: true },
			keep_scale: { label: 'dialog.uv_pack.keep_scale', type: 'checkbox', value: false },
			selection_only: { label: 'dialog.uv_unwrap.selection_only', type: 'checkbox', value: true },
		},
		onConfirm(form: PackFormResult) {
			const meshes: Mesh[] = Mesh.selected.slice();
			Undo.initEdit({ elements: meshes, uv_only: true });
			const report: UnwrapReport = packExistingIslands(meshes, {
				margin: form.margin,
				allow_rotation: form.allow_rotation,
				keep_scale: form.keep_scale,
				uv_width: UVEditor.getUVWidth(),
				uv_height: UVEditor.getUVHeight(),
			}, form.selection_only);
			meshes.forEach((mesh: Mesh) => Mesh.preview_controller.updateUV(mesh));
			UVEditor.loadData();
			Undo.finishEdit('Pack UV islands');
			Blockbench.showQuickMessage(reportMessage(report, tl('action.uv_pack_islands')), 2500);
		},
	});
	new Action('uv_pack_islands', {
		icon: 'dashboard',
		category: 'uv',
		condition: canRun,
		click() {
			pack_dialog.show();
		},
	});
});

declare global {
	interface BarItemRegistry {
		uv_smart_unwrap: Action
		uv_pack_islands: Action
	}
}
