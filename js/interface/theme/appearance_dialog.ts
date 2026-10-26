import { Dialog } from '../dialog';
import { ACCENT_PRESETS } from './accent_presets';
import { AppTheme } from './app_theme';
import { COLOR_MODES, CONTRAST_LEVEL_OPTIONS, SCHEME_VARIANTS, SURFACE_STYLES } from './appearance_settings';
import type { AppearanceSettings } from './appearance_settings';
import { generateColorScheme, parseHexColor } from './color_scheme';
import { SystemAccent } from './system_accent';
import type { SystemAccentReading } from './system_accent';

interface AccentSwatch {
	id: string
	name: string
	seed: string
	/** Container color shown as the swatch fill */
	fill: string
	/** Primary color shown as the swatch dot */
	dot: string
	/** Color of the check mark on the dot */
	on: string
}

const MODE_ICONS: Record<string, string> = { system: 'brightness_auto', light: 'light_mode', dark: 'dark_mode' };

let appearance_dialog: Dialog | null = null;

function createAppearanceDialog(): Dialog {
	return new Dialog({
		id: 'appearance',
		title: 'dialog.settings.theme',
		singleButton: true,
		width: 560,
		title_menu: new Menu([
			'settings_window',
			'keybindings_window',
			'theme_window',
			'about_window',
		]),
		component: {
			data() {
				return {
					s: { ...AppTheme.settings } as AppearanceSettings,
					system: SystemAccent.read() as SystemAccentReading | null,
					custom_text: AppTheme.settings.accent_custom,
					previous_source: 'preset' as AppearanceSettings['accent_source'],
					unsubscribe: null as null | (() => void),
				};
			},
			created() {
				this.unsubscribe = AppTheme.onChange((settings: AppearanceSettings) => {
					this.s = { ...settings };
				});
			},
			beforeDestroy() {
				this.unsubscribe?.();
			},
			computed: {
				modes(): Array<{ id: string, icon: string, name: string }> {
					return COLOR_MODES.map(id => ({ id, icon: MODE_ICONS[id], name: tl(`appearance.mode.${id}`) }));
				},
				swatches(): AccentSwatch[] {
					const options = { dark: AppTheme.dark, variant: this.s.variant, contrast: 'standard' as const, surface: this.s.surface };
					return ACCENT_PRESETS.map(preset => {
						const scheme = generateColorScheme({ ...options, seed: preset.seed });
						return {
							id: preset.id,
							name: tl(`appearance.accent.${preset.id}`),
							seed: preset.seed,
							fill: scheme['primary-container'],
							dot: scheme.primary,
							on: scheme['on-primary'],
						};
					});
				},
				roles(): string[] {
					const scheme = AppTheme.scheme;
					if (!scheme) return [];
					return [scheme.primary, scheme.secondary, scheme.tertiary, scheme['primary-container'], scheme['secondary-container'], scheme['surface-container-high']];
				},
				custom_valid(): boolean {
					return parseHexColor(this.custom_text) !== null;
				},
				custom_active(): boolean {
					return this.s.accent_source === 'custom';
				},
				system_active(): boolean {
					return this.s.accent_source === 'system';
				},
				options(): Record<string, Array<{ id: string, name: string }>> {
					const toOptions = (prefix: string, ids: readonly string[]) => ids.map(id => ({ id, name: tl(`${prefix}.${id}`) }));
					return {
						variant: toOptions('appearance.variant', SCHEME_VARIANTS),
						surface: toOptions('appearance.surface', SURFACE_STYLES),
						contrast: toOptions('appearance.contrast', CONTRAST_LEVEL_OPTIONS),
					};
				},
			},
			methods: {
				tl,
				set(key: keyof AppearanceSettings, value: AppearanceSettings[keyof AppearanceSettings]) {
					AppTheme.update({ [key]: value });
				},
				pickPreset(id: string) {
					AppTheme.update({ accent_source: 'preset', accent_preset: id as AppearanceSettings['accent_preset'] });
				},
				pickCustom(value: string) {
					const color = parseHexColor(value);
					if (!color) return;
					this.custom_text = color;
					AppTheme.update({ accent_source: 'custom', accent_custom: color });
				},
				onCustomInput(event: Event) {
					this.custom_text = (event.target as HTMLInputElement).value;
					if (this.custom_valid) this.pickCustom(this.custom_text);
				},
				toggleSystemAccent(event: Event) {
					const enabled = (event.target as HTMLInputElement).checked;
					if (enabled && this.s.accent_source !== 'system') this.previous_source = this.s.accent_source;
					AppTheme.update({ accent_source: enabled ? 'system' : this.previous_source });
				},
				reset() {
					AppTheme.reset();
					this.custom_text = AppTheme.settings.accent_custom;
				},
				refreshSystem() {
					this.system = SystemAccent.read();
				},
			},
			template: `
				<div id="appearance_editor">
					<section class="appearance_section">
						<h3>{{ tl('appearance.mode') }}</h3>
						<ul class="form_inline_select" role="radiogroup" :aria-label="tl('appearance.mode')">
							<li v-for="mode in modes" :key="mode.id" role="radio" tabindex="0" :aria-checked="s.mode == mode.id"
								:class="{selected: s.mode == mode.id}"
								@click="set('mode', mode.id)" @keydown.enter.prevent="set('mode', mode.id)" @keydown.space.prevent="set('mode', mode.id)">
								<i class="material-icons">{{ mode.icon }}</i>{{ mode.name }}
							</li>
						</ul>
					</section>

					<section class="appearance_section">
						<h3>{{ tl('appearance.accent') }}</h3>
						<div class="accent_grid" role="radiogroup" :aria-label="tl('appearance.accent')">
							<button v-for="swatch in swatches" :key="swatch.id" type="button" class="accent_swatch" role="radio"
								:aria-checked="s.accent_source == 'preset' && s.accent_preset == swatch.id"
								:class="{selected: s.accent_source == 'preset' && s.accent_preset == swatch.id}"
								:style="{'--swatch-fill': swatch.fill, '--swatch-dot': swatch.dot, '--swatch-on': swatch.on}"
								:title="swatch.name" :aria-label="swatch.name" @click="pickPreset(swatch.id)">
								<i class="material-icons">check</i>
							</button>
							<label class="accent_swatch accent_swatch_custom" :class="{selected: custom_active}" :title="tl('appearance.accent.custom')"
								:style="{'--swatch-fill': custom_active ? s.accent_custom : 'transparent', '--swatch-dot': custom_active ? s.accent_custom : 'currentColor', '--swatch-on': 'var(--md-on-primary)'}">
								<i class="material-icons">{{ custom_active ? 'check' : 'palette' }}</i>
								<input type="color" :value="s.accent_custom" :aria-label="tl('appearance.accent.custom')" @input="pickCustom($event.target.value)">
							</label>
						</div>
						<div class="form_bar accent_hex">
							<label class="name_space_left" for="appearance_hex">{{ tl('appearance.accent.custom.hex') }}</label>
							<input type="text" id="appearance_hex" class="dark_bordered focusable_input" maxlength="9" spellcheck="false"
								:value="custom_text" :aria-invalid="!custom_valid" @input="onCustomInput">
							<div class="form_supporting_text" v-if="!custom_valid">{{ tl('appearance.accent.invalid') }}</div>
						</div>
						<div class="form_bar form_bar_toggle" :class="{form_toggle_disabled: !system}">
							<label class="name_space_left" for="appearance_system_accent">{{ tl('appearance.system_accent') }}</label>
							<input type="checkbox" class="toggle_switch" id="appearance_system_accent" :checked="system_active" :disabled="!system" @change="toggleSystemAccent">
							<div class="form_supporting_text">
								<template v-if="system">{{ tl('appearance.system_accent.desc') }} <span class="accent_chip" :style="{background: system.color}"></span> {{ system.color }}</template>
								<template v-else>{{ tl('appearance.system_accent.unavailable') }}</template>
							</div>
						</div>
						<div class="appearance_roles" aria-hidden="true">
							<span v-for="color in roles" class="appearance_role" :style="{background: color}"></span>
						</div>
					</section>

					<section class="appearance_section">
						<h3>{{ tl('appearance.style') }}</h3>
						<div class="form_bar">
							<label class="name_space_left">{{ tl('appearance.variant') }}</label>
							<ul class="form_inline_select" role="radiogroup">
								<li v-for="o in options.variant" :key="o.id" role="radio" tabindex="0" :aria-checked="s.variant == o.id" :class="{selected: s.variant == o.id}"
									@click="set('variant', o.id)" @keydown.enter.prevent="set('variant', o.id)" @keydown.space.prevent="set('variant', o.id)">{{ o.name }}</li>
							</ul>
						</div>
						<div class="form_bar">
							<label class="name_space_left">{{ tl('appearance.surface') }}</label>
							<ul class="form_inline_select" role="radiogroup">
								<li v-for="o in options.surface" :key="o.id" role="radio" tabindex="0" :aria-checked="s.surface == o.id" :class="{selected: s.surface == o.id}"
									@click="set('surface', o.id)" @keydown.enter.prevent="set('surface', o.id)" @keydown.space.prevent="set('surface', o.id)">{{ o.name }}</li>
							</ul>
						</div>
						<div class="form_bar">
							<label class="name_space_left">{{ tl('appearance.contrast') }}</label>
							<ul class="form_inline_select" role="radiogroup">
								<li v-for="o in options.contrast" :key="o.id" role="radio" tabindex="0" :aria-checked="s.contrast == o.id" :class="{selected: s.contrast == o.id}"
									@click="set('contrast', o.id)" @keydown.enter.prevent="set('contrast', o.id)" @keydown.space.prevent="set('contrast', o.id)">{{ o.name }}</li>
							</ul>
						</div>
						<div class="form_bar form_bar_toggle">
							<label class="name_space_left" for="appearance_glass">{{ tl('appearance.glass') }}</label>
							<input type="checkbox" class="toggle_switch" id="appearance_glass" :checked="s.glass" @change="set('glass', $event.target.checked)">
							<div class="form_supporting_text">{{ tl('appearance.glass.desc') }}</div>
						</div>
					</section>

					<section class="appearance_section appearance_actions">
						<button type="button" class="minor" @click="reset()">{{ tl('appearance.reset') }}</button>
					</section>
				</div>`,
		},
		onOpen() {
			this.content_vue.refreshSystem();
		},
	});
}

export function openAppearanceDialog(): void {
	if (!appearance_dialog) appearance_dialog = createAppearanceDialog();
	appearance_dialog.show();
}

BARS.defineActions(function () {
	new Action('theme_window', {
		name: tl('dialog.settings.theme') + '...',
		icon: 'style',
		category: 'blockbench',
		click: openAppearanceDialog,
	});
});
