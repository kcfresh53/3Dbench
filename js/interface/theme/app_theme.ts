import { electron } from '../../native_apis';
import { getPresetSeed } from './accent_presets';
import { DEFAULT_APPEARANCE, sanitizeAppearance } from './appearance_settings';
import type { AppearanceSettings } from './appearance_settings';
import { deriveViewportColors, generateColorScheme, parseHexColor } from './color_scheme';
import type { ColorScheme } from './color_scheme';
import { SystemAccent } from './system_accent';
import { buildThemeCss, deriveLegacyColors } from './theme_css';
import type { LegacyColors } from './theme_css';

const STORAGE_KEY = 'appearance';
const BOOT_CACHE_KEY = 'appearance_boot';

type AppearanceListener = (settings: Readonly<AppearanceSettings>) => void;

/**
 * Application appearance: a Material 3 dynamic color scheme from an accent seed, light or dark, plus the
 * glass option. The generated tokens are written to #theme_css and cached so the next launch paints
 * correctly before the application bundle runs.
 */
export class AppTheme {
	static settings: AppearanceSettings = { ...DEFAULT_APPEARANCE };
	static scheme: ColorScheme | null = null;
	static colors: LegacyColors = {} as LegacyColors;
	static dark: boolean = true;
	/** The seed color used for the active scheme. */
	static seed: string = getPresetSeed(DEFAULT_APPEARANCE.accent_preset);

	private static listeners: Set<AppearanceListener> = new Set();
	private static color_scheme_query: MediaQueryList | null = null;

	/** Loads stored settings, subscribes to operating system changes and applies the theme. */
	static load(): void {
		let stored: unknown = null;
		try {
			stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
			// Settings of the retired file-based theme system are not migrated.
			localStorage.removeItem('theme');
			localStorage.removeItem('themes_sideloaded');
		} catch (error) {}
		this.settings = sanitizeAppearance(stored);

		this.color_scheme_query = window.matchMedia('(prefers-color-scheme: dark)');
		this.color_scheme_query.addEventListener('change', () => {
			if (this.settings.mode === 'system') this.apply();
		});
		SystemAccent.subscribe(() => {
			if (this.settings.accent_source === 'system') this.apply();
		});
		this.apply();
	}

	static update(changes: Partial<AppearanceSettings>): void {
		this.settings = sanitizeAppearance({ ...this.settings, ...changes });
		this.save();
		this.apply();
	}

	static reset(): void {
		this.settings = { ...DEFAULT_APPEARANCE };
		this.save();
		this.apply();
	}

	static onChange(listener: AppearanceListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	static resolveDark(): boolean {
		if (this.settings.mode === 'system') return this.color_scheme_query?.matches ?? true;
		return this.settings.mode === 'dark';
	}

	static resolveSeed(): string {
		const settings = this.settings;
		if (settings.accent_source === 'system') {
			const reading = SystemAccent.read();
			if (reading) return reading.color;
		}
		if (settings.accent_source === 'custom') {
			const custom = parseHexColor(settings.accent_custom);
			if (custom) return custom;
		}
		return getPresetSeed(settings.accent_preset);
	}

	static apply(): void {
		const settings = this.settings;
		const dark = this.resolveDark();
		const seed = this.resolveSeed();
		const scheme = generateColorScheme({
			seed, dark, variant: settings.variant, contrast: settings.contrast, surface: settings.surface,
		});
		const viewport = deriveViewportColors(scheme, dark);
		const css = buildThemeCss({ scheme, viewport, dark });

		this.scheme = scheme;
		this.colors = deriveLegacyColors(scheme, viewport);
		this.dark = dark;
		this.seed = seed;

		const style = document.getElementById('theme_css');
		if (style) style.textContent = css;
		document.body.dataset.glass = settings.glass ? 'on' : 'off';
		document.body.dataset.colorMode = dark ? 'dark' : 'light';
		try {
			if (electron) electron.nativeTheme.themeSource = settings.mode;
		} catch (error) {}
		try {
			localStorage.setItem(BOOT_CACHE_KEY, JSON.stringify({ css, dark, glass: settings.glass, frame: this.colors.frame }));
		} catch (error) {}

		this.updateColors();
		this.listeners.forEach(listener => listener(this.settings));
	}

	/** Pushes theme colors to the document chrome and the three.js viewport. */
	static updateColors(): void {
		const colors = this.colors;
		$('meta[name=theme-color]').attr('content', colors.frame);
		document.body.classList.toggle('light_mode', !this.dark);

		// The viewport objects are created by initCanvas(); until then only the CSS side applies.
		if (typeof Canvas == 'undefined' || !Canvas.gizmo_colors || !Canvas.ground_plane || !Canvas.gridMaterial
			|| !Canvas.wireframeMaterial || !Canvas.outlineMaterial || !Canvas.outlineUnselectedMaterial
			|| !Canvas.brush_outline || !Canvas.pivot_marker) return;
		const gizmo_colors = Canvas.gizmo_colors;
		const preview = document.getElementById('preview');
		if (!preview) return;
		const preview_style = window.getComputedStyle(preview);
		function update(three_color: THREE.Color, variable: string): void {
			const value = preview_style.getPropertyValue(variable).trim();
			if (value) three_color.set(value);
		}
		update(gizmo_colors.r, '--color-axis-x');
		update(gizmo_colors.g, '--color-axis-y');
		update(gizmo_colors.b, '--color-axis-z');
		update(gizmo_colors.grid, '--color-grid');
		update(gizmo_colors.u, '--color-axis-u'); // spline space colors
		update(gizmo_colors.v, '--color-axis-v');
		update(gizmo_colors.w, '--color-axis-w');
		update(Canvas.gridMaterial.color, '--color-grid');
		update(Canvas.wireframeMaterial.color, '--color-wireframe');
		update(gizmo_colors.solid, '--color-solid');
		update(gizmo_colors.outline, '--color-outline');
		update(gizmo_colors.gizmo_hover, '--color-gizmohover');
		update(Canvas.outlineMaterial.color, '--color-outline');
		update(Canvas.outlineUnselectedMaterial.color, '--color-constant-outline');
		update((Canvas.ground_plane.material as THREE.MeshBasicMaterial).color, '--color-ground');
		update((Canvas.brush_outline.material as THREE.ShaderMaterial).uniforms.color.value, '--color-brush-outline');
		update(gizmo_colors.spline_handle_aligned, '--color-spline-handle-aligned');
		update(gizmo_colors.spline_handle_mirrored, '--color-spline-handle-mirrored');
		update(gizmo_colors.spline_handle_free, '--color-spline-handle-free');
		Canvas.pivot_marker.children.forEach(child => {
			// @ts-ignore updateColors is added to the marker helpers
			child.updateColors();
		});
	}

	private static save(): void {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
		} catch (error) {}
	}
}

/**
 * Third-party plugins written against the retired CustomTheme object only read colors and request a refresh.
 * @deprecated Use AppTheme.
 */
const custom_theme_compat = {
	get data() { return { colors: AppTheme.colors }; },
	get selected() { return { colors: AppTheme.colors }; },
	updateColors: () => AppTheme.updateColors(),
};

const global = {
	AppTheme,
};
declare global {
	const AppTheme: typeof global.AppTheme
	type AppTheme = import('./app_theme').AppTheme
}
Object.assign(window, global, { CustomTheme: custom_theme_compat });
