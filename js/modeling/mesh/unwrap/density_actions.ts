import { equalizeTexelDensity, TexelDensityReport } from './texel_density';
import { DEFAULT_UNWRAP_OPTIONS } from './types';

interface DensityFormResult {
	auto: boolean
	target: number
	repack: boolean
	margin: number
	allow_rotation: boolean
	selection_only: boolean
}

BARS.defineActions(function() {
	const dialog: Dialog = new Dialog({
		id: 'uv_equalize_texel_density',
		title: 'action.uv_equalize_texel_density',
		form: {
			auto: {label: 'dialog.texel_density.auto', type: 'checkbox', value: true},
			target: {
				label: 'dialog.texel_density.target', type: 'number', value: 1, min: 0.01, max: 1000, step: 0.1,
				condition: (form: DensityFormResult) => !form.auto,
			},
			repack: {label: 'dialog.texel_density.repack', type: 'checkbox', value: true},
			margin: {
				label: 'dialog.uv_unwrap.margin', type: 'number', value: DEFAULT_UNWRAP_OPTIONS.margin, min: 0, max: 64, step: 1,
				condition: (form: DensityFormResult) => form.repack,
			},
			allow_rotation: {
				label: 'dialog.uv_unwrap.allow_rotation', type: 'checkbox', value: true,
				condition: (form: DensityFormResult) => form.repack,
			},
			selection_only: {label: 'dialog.uv_unwrap.selection_only', type: 'checkbox', value: false},
		},
		onConfirm(form: DensityFormResult) {
			const meshes: Mesh[] = Mesh.selected.slice();
			Undo.initEdit({elements: meshes, uv_only: true});
			const report: TexelDensityReport = equalizeTexelDensity(meshes, {
				target: form.auto ? 0 : form.target,
				repack: form.repack,
				margin: form.margin,
				allow_rotation: form.allow_rotation,
				selection_only: form.selection_only,
				uv_width: UVEditor.getUVWidth(),
				uv_height: UVEditor.getUVHeight(),
			});
			meshes.forEach((mesh: Mesh) => Mesh.preview_controller.updateUV(mesh));
			UVEditor.loadData();
			Undo.finishEdit('Equalize texel density');
			Blockbench.showQuickMessage(
				tl('message.texel_density.done', [report.island_count, report.density.toFixed(2), report.spread_before.toFixed(2)]), 3000
			);
		},
	});
	new Action('uv_equalize_texel_density', {
		icon: 'grid_on',
		category: 'uv',
		condition: () => Modes.edit && Mesh.selected.length > 0,
		click() {
			dialog.show();
		},
	});
});

declare global {
	interface BarItemRegistry {
		uv_equalize_texel_density: Action
	}
}
