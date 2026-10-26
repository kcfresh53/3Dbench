import {
	DynamicScheme,
	Hct,
	MaterialDynamicColors,
	SchemeExpressive,
	SchemeNeutral,
	SchemeTonalSpot,
	SchemeVibrant,
	TonalPalette,
	argbFromHex,
	hexFromArgb,
} from '@material/material-color-utilities';
import type { DynamicColor } from '@material/material-color-utilities';

/**
 * Material 3 dynamic color: a seed color is turned into tonal palettes (HCT), and the palettes are resolved
 * into the system color roles https://m3.material.io/styles/color/roles for light or dark.
 * This module is pure (no DOM, no Electron) so it can be unit tested in plain Node.
 */

export type SchemeVariant = 'tonal_spot' | 'vibrant' | 'expressive' | 'neutral';
export type ContrastLevel = 'standard' | 'medium' | 'high';
/** "graphite" lowers the chroma of the neutral palettes so surfaces read as grey. "tinted" is stock Material. */
export type SurfaceStyle = 'graphite' | 'tinted';

export interface ColorSchemeOptions {
	/** Seed color as #rgb, #rrggbb or rrggbb. */
	seed: string
	dark: boolean
	variant: SchemeVariant
	contrast: ContrastLevel
	surface: SurfaceStyle
}

/** Contrast levels from the Material specification: standard 0, medium 0.5, high 1. */
const CONTRAST_LEVELS: Record<ContrastLevel, number> = { standard: 0, medium: 0.5, high: 1 };
const GRAPHITE_NEUTRAL_CHROMA = 1;
const GRAPHITE_NEUTRAL_VARIANT_CHROMA = 2;
const SPEC_VERSION = '2025';

type RoleMethod = {
	[K in keyof MaterialDynamicColors]: MaterialDynamicColors[K] extends () => DynamicColor ? K : never
}[keyof MaterialDynamicColors];

/** CSS role name (--md-sys-color-<name>) mapped to the library accessor that resolves it. */
const ROLE_METHODS = {
	'primary': 'primary',
	'on-primary': 'onPrimary',
	'primary-container': 'primaryContainer',
	'on-primary-container': 'onPrimaryContainer',
	'primary-fixed': 'primaryFixed',
	'primary-fixed-dim': 'primaryFixedDim',
	'on-primary-fixed': 'onPrimaryFixed',
	'on-primary-fixed-variant': 'onPrimaryFixedVariant',
	'secondary': 'secondary',
	'on-secondary': 'onSecondary',
	'secondary-container': 'secondaryContainer',
	'on-secondary-container': 'onSecondaryContainer',
	'secondary-fixed': 'secondaryFixed',
	'secondary-fixed-dim': 'secondaryFixedDim',
	'on-secondary-fixed': 'onSecondaryFixed',
	'on-secondary-fixed-variant': 'onSecondaryFixedVariant',
	'tertiary': 'tertiary',
	'on-tertiary': 'onTertiary',
	'tertiary-container': 'tertiaryContainer',
	'on-tertiary-container': 'onTertiaryContainer',
	'tertiary-fixed': 'tertiaryFixed',
	'tertiary-fixed-dim': 'tertiaryFixedDim',
	'on-tertiary-fixed': 'onTertiaryFixed',
	'on-tertiary-fixed-variant': 'onTertiaryFixedVariant',
	'error': 'error',
	'on-error': 'onError',
	'error-container': 'errorContainer',
	'on-error-container': 'onErrorContainer',
	'background': 'background',
	'on-background': 'onBackground',
	'surface': 'surface',
	'surface-dim': 'surfaceDim',
	'surface-bright': 'surfaceBright',
	'surface-container-lowest': 'surfaceContainerLowest',
	'surface-container-low': 'surfaceContainerLow',
	'surface-container': 'surfaceContainer',
	'surface-container-high': 'surfaceContainerHigh',
	'surface-container-highest': 'surfaceContainerHighest',
	'on-surface': 'onSurface',
	'surface-variant': 'surfaceVariant',
	'on-surface-variant': 'onSurfaceVariant',
	'outline': 'outline',
	'outline-variant': 'outlineVariant',
	'inverse-surface': 'inverseSurface',
	'inverse-on-surface': 'inverseOnSurface',
	'inverse-primary': 'inversePrimary',
	'shadow': 'shadow',
	'scrim': 'scrim',
	'surface-tint': 'surfaceTint',
} as const satisfies Record<string, RoleMethod>;

export type ColorRole = keyof typeof ROLE_METHODS;
export type ColorScheme = Record<ColorRole, string>;

export const COLOR_ROLES = Object.keys(ROLE_METHODS) as ColorRole[];

/** Accepts #rgb, #rrggbb, rrggbb and rrggbbaa (alpha is dropped). Returns #rrggbb or null. */
export function parseHexColor(input: string | null | undefined): string | null {
	if (!input) return null;
	let value = input.trim().replace(/^#/, '').toLowerCase();
	if (/^[0-9a-f]{3}$/.test(value)) value = value.split('').map(c => c + c).join('');
	else if (/^[0-9a-f]{8}$/.test(value)) value = value.slice(0, 6);
	if (!/^[0-9a-f]{6}$/.test(value)) return null;
	return '#' + value;
}

function createBaseScheme(seed: string, dark: boolean, variant: SchemeVariant, contrast_level: number): DynamicScheme {
	const source = Hct.fromInt(argbFromHex(seed));
	switch (variant) {
		case 'vibrant': return new SchemeVibrant(source, dark, contrast_level, SPEC_VERSION);
		case 'expressive': return new SchemeExpressive(source, dark, contrast_level, SPEC_VERSION);
		case 'neutral': return new SchemeNeutral(source, dark, contrast_level, SPEC_VERSION);
		default: return new SchemeTonalSpot(source, dark, contrast_level, SPEC_VERSION);
	}
}

export function createDynamicScheme(options: ColorSchemeOptions): DynamicScheme {
	const seed = parseHexColor(options.seed);
	if (!seed) throw new Error(`Invalid seed color: ${options.seed}`);
	const contrast_level = CONTRAST_LEVELS[options.contrast] ?? 0;
	const base = createBaseScheme(seed, options.dark, options.variant, contrast_level);
	if (options.surface === 'tinted') return base;
	return new DynamicScheme({
		sourceColorHct: base.sourceColorHct,
		variant: base.variant,
		contrastLevel: contrast_level,
		isDark: options.dark,
		platform: base.platform,
		specVersion: SPEC_VERSION,
		primaryPalette: base.primaryPalette,
		secondaryPalette: base.secondaryPalette,
		tertiaryPalette: base.tertiaryPalette,
		errorPalette: base.errorPalette,
		neutralPalette: TonalPalette.fromHueAndChroma(base.neutralPalette.hue, GRAPHITE_NEUTRAL_CHROMA),
		neutralVariantPalette: TonalPalette.fromHueAndChroma(base.neutralVariantPalette.hue, GRAPHITE_NEUTRAL_VARIANT_CHROMA),
	});
}

/** Resolves every system color role for the given options. All values are #rrggbb. */
export function generateColorScheme(options: ColorSchemeOptions): ColorScheme {
	const scheme = createDynamicScheme(options);
	const roles = new MaterialDynamicColors();
	const result = {} as ColorScheme;
	for (const role of COLOR_ROLES) {
		const color = roles[ROLE_METHODS[role]]();
		result[role] = hexFromArgb(color.getArgb(scheme)).toLowerCase();
	}
	return result;
}

/** Linear sRGB mix, matching CSS color-mix(in srgb, a (1 - t), b t). */
export function mixHex(a: string, b: string, t: number): string {
	const parse = (hex: string): number[] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
	const [ar, ag, ab] = parse(a);
	const [br, bg, bb] = parse(b);
	const channel = (x: number, y: number): string => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
	return '#' + channel(ar, br) + channel(ag, bg) + channel(ab, bb);
}

/** Colors read by the three.js viewport. They must be resolved hex values because three.js cannot parse color-mix(). */
export interface ViewportColors {
	stage: string
	grid: string
	ground: string
	wireframe: string
	checkerboard: string
}

export function deriveViewportColors(scheme: ColorScheme, dark: boolean): ViewportColors {
	const stage = dark
		? mixHex(scheme['surface-container-lowest'], scheme['surface-container-low'], 0.6)
		: mixHex(scheme['surface-container-low'], scheme['surface-container-highest'], 0.35);
	return {
		stage,
		grid: mixHex(stage, scheme['on-surface'], dark ? 0.22 : 0.2),
		ground: mixHex(stage, scheme['surface-container-low'], 0.5),
		wireframe: mixHex(stage, scheme['on-surface'], 0.8),
		checkerboard: mixHex(scheme['surface-container-lowest'], scheme['surface-container-low'], 0.5),
	};
}
