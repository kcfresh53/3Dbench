import type { PresetName, Species, TreeParams, Variant } from '../core/types';
/** Fields a preset controls. User-level settings are kept when switching preset. */
export type PresetLook = Omit<TreeParams, 'seed' | 'separateFoliage' | 'lodCount' | 'spreadLods' | 'useCustomTextures' | 'useBundledTextures' | 'barkImage' | 'leafImage'>;
export type UserSettings = Pick<TreeParams, 'seed' | 'separateFoliage' | 'lodCount' | 'spreadLods' | 'useCustomTextures' | 'useBundledTextures' | 'barkImage' | 'leafImage'>;
export declare const SPECIES_LABELS: Record<Species, string>;
export declare const VARIANT_LABELS: Record<Variant, string>;
export declare const PRESET_LOOKS: Record<PresetName, PresetLook>;
export declare const USER_DEFAULTS: UserSettings;
export declare function presetParams(name: PresetName): TreeParams;
export declare function presetLabel(name: PresetName): string;
export declare const PRESET_NAMES: PresetName[];
