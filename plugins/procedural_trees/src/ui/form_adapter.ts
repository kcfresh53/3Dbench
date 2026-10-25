import type { PresetName, TreeParams } from '../core/types';
import { FORM_ENTRIES, isFieldSpec } from './field_specs';
import type { FieldSpec } from './field_specs';
import { PRESET_NAMES, presetLabel } from './presets';
import type { PresetLook } from './presets';

export type FormValues = Record<string, unknown>;

/** Image slots return a file object (with a data URL in `content`) instead of a plain value. */
interface ImageFileResult {
	content?: string;
	path?: string;
}

export interface ImageSlots {
	barkImage: string;
	leafImage: string;
}

const IMAGE_EXTENSIONS: string[] = ['png', 'jpg', 'jpeg', 'webp'];

function presetOptions(): Record<string, string> {
	const options: Record<string, string> = {};
	for (const name of PRESET_NAMES) options[name] = presetLabel(name);
	return options;
}

function fieldToFormElement(spec: FieldSpec, value: unknown): Record<string, unknown> {
	const element: Record<string, unknown> = { label: spec.label, type: spec.type, value };
	if (spec.type === 'number') {
		element.min = spec.min;
		element.max = spec.max;
		element.step = spec.step;
	}
	if (spec.type === 'select') {
		element.options = spec.options;
		element.value = String(value);
	}
	if (spec.type === 'file') {
		element.value = value ? { name: spec.label + ' (embedded)', path: '', content: value } : '';
		element.extensions = IMAGE_EXTENSIONS;
		element.resource_id = 'tree_texture';
		element.readtype = 'image';
		element.return_as = 'file';
	}
	if (spec.description) element.description = spec.description;
	return element;
}

/** Builds the dialog `form` object from the field table. */
export function buildForm(params: TreeParams, preset: PresetName, onReset?: () => void): Record<string, unknown> {
	const form: Record<string, unknown> = {
		preset: { label: 'Preset', type: 'select', options: presetOptions(), value: preset },
	};
	if (onReset) form._resetPreset = { type: 'buttons', buttons: ['Reset shape to preset'], click: onReset };
	let separators = 0;
	for (const entry of FORM_ENTRIES) {
		if (isFieldSpec(entry)) {
			form[entry.key] = fieldToFormElement(entry, params[entry.key]);
		} else {
			form[`_sep${separators++}`] = '_';
			form[`_title${separators}`] = { type: 'info', text: entry.separator };
		}
	}
	return form;
}

/** Look fields as dialog values (selects stringified), for `setFormValues` on preset switch. */
export function lookToFormValues(look: PresetLook): FormValues {
	const values: FormValues = {};
	for (const entry of FORM_ENTRIES) {
		if (!isFieldSpec(entry) || entry.type === 'file') continue;
		const key = entry.key as keyof PresetLook;
		if (!(key in look)) continue;
		values[entry.key] = entry.type === 'select' ? String(look[key]) : look[key];
	}
	return values;
}

function readColor(value: unknown): string {
	if (typeof value === 'string') return value;
	const maybe: { toHexString?: () => string } | null = value as { toHexString?: () => string } | null;
	if (maybe && typeof maybe.toHexString === 'function') return maybe.toHexString();
	return '#808080';
}

function readImage(value: unknown, cached: string): string {
	const file: ImageFileResult | undefined = value as ImageFileResult | undefined;
	if (file && typeof file === 'object' && typeof file.content === 'string' && file.content) return file.content;
	return value === undefined || value === '' ? '' : cached;
}

/**
 * Converts raw dialog output back into a typed TreeParams.
 * `images` holds the last picked images so an unchanged slot keeps its picture.
 */
export function readParams(values: FormValues, fallback: TreeParams, images: ImageSlots): TreeParams {
	const result: Record<string, unknown> = { ...fallback };
	for (const entry of FORM_ENTRIES) {
		if (!isFieldSpec(entry)) continue;
		const raw: unknown = values[entry.key];
		if (entry.type === 'file') {
			result[entry.key] = readImage(raw, images[entry.key as keyof ImageSlots]);
			continue;
		}
		if (raw === undefined) continue;
		switch (entry.type) {
			case 'number': {
				const n: number = Math.max(entry.min ?? -Infinity, Math.min(entry.max ?? Infinity, Number(raw)));
				if (!Number.isFinite(n)) break;
				result[entry.key] = entry.integer ? Math.round(n) : n;
				break;
			}
			case 'select':
				if (entry.options && !(String(raw) in entry.options)) break;
				result[entry.key] = entry.numeric ? Number(raw) : String(raw);
				break;
			case 'checkbox':
				result[entry.key] = Boolean(raw);
				break;
			case 'color':
				result[entry.key] = readColor(raw);
				break;
		}
	}
	return result as unknown as TreeParams;
}
