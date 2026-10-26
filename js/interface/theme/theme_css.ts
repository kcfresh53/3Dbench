import { COLOR_ROLES } from './color_scheme';
import type { ColorScheme, ViewportColors } from './color_scheme';

/** The semantic palette older application code and plugins read as --color-*. It is derived, not authored. */
export interface LegacyColors {
	ui: string
	back: string
	dark: string
	border: string
	selected: string
	elevated: string
	button: string
	bright_ui: string
	accent: string
	frame: string
	text: string
	light: string
	accent_text: string
	bright_ui_text: string
	subtle_text: string
	grid: string
	wireframe: string
	checkerboard: string
}

export function deriveLegacyColors(scheme: ColorScheme, viewport: ViewportColors): LegacyColors {
	return {
		ui: scheme['surface-container'],
		back: scheme['surface-container-low'],
		dark: viewport.stage,
		border: scheme['outline-variant'],
		selected: scheme['secondary-container'],
		elevated: scheme['surface-container-high'],
		button: scheme['surface-container-highest'],
		bright_ui: scheme['surface-container-high'],
		accent: scheme.primary,
		frame: scheme['surface-dim'],
		text: scheme['on-surface'],
		light: scheme['on-surface'],
		accent_text: scheme['on-primary'],
		bright_ui_text: scheme['on-surface'],
		subtle_text: scheme['on-surface-variant'],
		grid: viewport.grid,
		wireframe: viewport.wireframe,
		checkerboard: viewport.checkerboard,
	};
}

export interface ThemeCssInput {
	scheme: ColorScheme
	viewport: ViewportColors
	dark: boolean
}

/** Builds the generated token sheet: system color roles, the legacy --color-* aliases and viewport colors. */
export function buildThemeCss(input: ThemeCssInput): string {
	const { scheme, viewport, dark } = input;
	const declarations: string[] = [`color-scheme: ${dark ? 'dark' : 'light'};`];
	for (const role of COLOR_ROLES) {
		declarations.push(`--md-sys-color-${role}: ${scheme[role]};`);
	}
	const legacy = deriveLegacyColors(scheme, viewport);
	for (const key of Object.keys(legacy) as Array<keyof LegacyColors>) {
		declarations.push(`--color-${key}: ${legacy[key]};`);
	}
	declarations.push(`--color-error: ${scheme.error};`);
	declarations.push(`--md-viewport-stage: ${viewport.stage};`);
	declarations.push(`--md-viewport-ground: ${viewport.ground};`);
	declarations.push(`--font-custom-main: 'Outfit';`, `--font-custom-headline: 'Outfit';`);
	return `@layer theme {\nbody {\n\t${declarations.join('\n\t')}\n}\n}\n`;
}
