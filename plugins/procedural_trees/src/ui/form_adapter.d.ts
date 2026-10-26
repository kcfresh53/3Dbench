import type { PresetName, TreeParams } from '../core/types';
import type { PresetLook } from './presets';
export type FormValues = Record<string, unknown>;
export interface ImageSlots {
    barkImage: string;
    leafImage: string;
}
/** Builds the dialog `form` object from the field table. */
export declare function buildForm(params: TreeParams, preset: PresetName, onReset?: () => void): Record<string, unknown>;
/** Look fields as dialog values (selects stringified), for `setFormValues` on preset switch. */
export declare function lookToFormValues(look: PresetLook): FormValues;
/**
 * Converts raw dialog output back into a typed TreeParams.
 * `images` holds the last picked images so an unchanged slot keeps its picture.
 */
export declare function readParams(values: FormValues, fallback: TreeParams, images: ImageSlots): TreeParams;
