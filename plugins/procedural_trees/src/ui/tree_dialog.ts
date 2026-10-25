import type { PresetName, TreeLod, TreeParams } from '../core/types';
import { generateTreeSet } from '../core/tree_generator';
import { paintAtlas } from '../texture/atlas';
import { PRESET_LOOKS, USER_DEFAULTS, presetParams } from './presets';
import { buildForm, lookToFormValues, readParams } from './form_adapter';
import type { FormValues, ImageSlots } from './form_adapter';
import { makePreview } from './preview';
import type { TreePreview } from './preview';

export interface TreeDialogRequest {
	preset: PresetName;
	params: TreeParams;
	/** True when regenerating an existing tree group. */
	editing: boolean;
}

/** Remembered between openings so the dialog starts where the user left off. */
let lastPreset: PresetName = 'oak_realistic';
let lastParams: TreeParams = presetParams('oak_realistic');


export function defaultRequest(): TreeDialogRequest {
	return { preset: lastPreset, params: { ...lastParams }, editing: false };
}

function summarize(lods: TreeLod[]): string {
	const tris: string = lods.map((l: TreeLod, i: number): string => `LOD${i} ${l.triangles.toLocaleString()} tris`).join('  ·  ');
	return lods.some((l: TreeLod): boolean => !l.withinBudget) ? `${tris}  ·  budget too low for this tree` : tris;
}

/** Opens the generator with a live preview. `onConfirm` receives the final parameters. */
export function openTreeDialog(
	request: TreeDialogRequest,
	onConfirm: (params: TreeParams, preset: PresetName) => void,
): void {
	let currentPreset: PresetName = request.preset;
	const images: ImageSlots = { barkImage: request.params.barkImage || '', leafImage: request.params.leafImage || '' };

	let preview: TreePreview | null = null;
	let statusNode: HTMLElement | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let token = 0;

	const base = (): TreeParams => ({ ...PRESET_LOOKS[currentPreset], ...USER_DEFAULTS });

	async function refresh(values: FormValues): Promise<void> {
		const current: number = ++token;
		try {
			const params: TreeParams = readParams(values, base(), images);
			images.barkImage = params.barkImage;
			images.leafImage = params.leafImage;
			const lods: TreeLod[] = generateTreeSet({ ...params, spreadLods: true });
			const atlas: string = await paintAtlas(params);
			if (current !== token) return;
			preview?.update(lods, atlas, params.variant === 'stylized', summarize(lods));
			statusNode?.classList.remove('tree_error');
		} catch (error) {
			if (current !== token || !statusNode) return;
			statusNode.textContent = (error as Error).message;
			statusNode.classList.add('tree_error');
		}
	}

	const dialog: Dialog = new Dialog({
		id: 'tree_generator_dialog',
		title: request.editing ? 'Edit Procedural Tree' : 'Procedural Tree',
		width: 1080,
		buttons: [request.editing ? 'Regenerate Tree' : 'Create Tree', 'Cancel'],
		part_order: ['component', 'form'],
		form: buildForm(request.params, request.preset, () => dialog.setFormValues(lookToFormValues(PRESET_LOOKS[currentPreset]) as never)),
		component: {
			template:
				'<div class="tree_view"><div class="tree_heading"><span>GAME-READY TREES</span><span>drag · scroll · double-click</span></div>' +
				'<canvas ref="canvas" aria-label="Tree preview"></canvas><p ref="status" class="tree_stats"></p>' +
				'<p class="tree_hint">Triangle counts update live. Textures: realistic presets include CC0 photographs. Override them in Texture slots.</p></div>',
			mounted(this: { $refs: { canvas: HTMLCanvasElement; status: HTMLElement } }): void {
				statusNode = this.$refs.status;
				try {
					preview = makePreview(this.$refs.canvas, statusNode);
				} catch (error) {
					statusNode.textContent = 'Preview unavailable. You can still create the tree.';
					console.error(error);
				}
			},
		},
		onFormChange(values: FormValues): void {
			const preset: PresetName = values.preset as PresetName;
			if (preset !== currentPreset) {
				currentPreset = preset;
				const look: FormValues = lookToFormValues(PRESET_LOOKS[preset]);
				dialog.setFormValues(look as never, false);
				values = { ...values, ...look };
			}
			clearTimeout(timer);
			timer = setTimeout((): void => void refresh(values), 120);
		},
		onConfirm(values: FormValues): void {
			const params: TreeParams = readParams(values, base(), images);
			lastPreset = currentPreset;
			lastParams = params;
			onConfirm(params, currentPreset);
		},
		onClose(): void {
			clearTimeout(timer);
			token++;
			preview?.dispose();
			preview = null;
			queueMicrotask((): void => dialog.delete());
		},
	} as never);
	dialog.show();
	// The component mounts before the form because of part_order. Read the
	// initial values only after show() finishes building both dialog parts.
	void refresh(dialog.getFormResult() as FormValues);
}
