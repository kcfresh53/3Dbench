import { ACCENT_PRESETS, DEFAULT_ACCENT_PRESET, getPresetSeed } from './accent_presets';
import type { AccentPresetId } from './accent_presets';
import { parseHexColor } from './color_scheme';
import type { ContrastLevel, SchemeVariant, SurfaceStyle } from './color_scheme';

export type ColorMode = 'system' | 'light' | 'dark';
export type AccentSource = 'preset' | 'custom' | 'system';

export interface AppearanceSettings {
	mode: ColorMode
	accent_source: AccentSource
	accent_preset: AccentPresetId
	/** Custom seed color, #rrggbb */
	accent_custom: string
	variant: SchemeVariant
	contrast: ContrastLevel
	surface: SurfaceStyle
	/** Translucent, blurred floating surfaces */
	glass: boolean
}

export const COLOR_MODES: readonly ColorMode[] = ['system', 'light', 'dark'];
export const SCHEME_VARIANTS: readonly SchemeVariant[] = ['tonal_spot', 'vibrant', 'expressive', 'neutral'];
export const CONTRAST_LEVEL_OPTIONS: readonly ContrastLevel[] = ['standard', 'medium', 'high'];
export const SURFACE_STYLES: readonly SurfaceStyle[] = ['graphite', 'tinted'];

export const DEFAULT_APPEARANCE: Readonly<AppearanceSettings> = {
	mode: 'dark',
	accent_source: 'preset',
	accent_preset: DEFAULT_ACCENT_PRESET,
	accent_custom: getPresetSeed(DEFAULT_ACCENT_PRESET),
	variant: 'tonal_spot',
	contrast: 'standard',
	surface: 'graphite',
	glass: true,
};

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return allowed.includes(value as T) ? value as T : fallback;
}

/** Validates stored data field by field so a corrupt or outdated profile can never break startup. */
export function sanitizeAppearance(raw: unknown): AppearanceSettings {
	const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const defaults = DEFAULT_APPEARANCE;
	return {
		mode: pick(data.mode, COLOR_MODES, defaults.mode),
		accent_source: pick(data.accent_source, ['preset', 'custom', 'system'] as const, defaults.accent_source),
		accent_preset: pick(data.accent_preset, ACCENT_PRESETS.map(preset => preset.id), defaults.accent_preset),
		accent_custom: parseHexColor(data.accent_custom as string) ?? defaults.accent_custom,
		variant: pick(data.variant, SCHEME_VARIANTS, defaults.variant),
		contrast: pick(data.contrast, CONTRAST_LEVEL_OPTIONS, defaults.contrast),
		surface: pick(data.surface, SURFACE_STYLES, defaults.surface),
		glass: typeof data.glass === 'boolean' ? data.glass : defaults.glass,
	};
}
