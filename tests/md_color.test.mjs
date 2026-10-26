import assert from 'node:assert/strict';
import { test } from 'node:test';

const engine = await import('../js/interface/theme/color_scheme.ts');
const css = await import('../js/interface/theme/theme_css.ts');
const model = await import('../js/interface/theme/appearance_settings.ts');
const presets = await import('../js/interface/theme/accent_presets.ts');

const luminance = (hex) => {
	const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
		.map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};
const HEX = /^#[0-9a-f]{6}$/;
const BASE = { seed: '#e9b979', dark: true, variant: 'tonal_spot', contrast: 'standard', surface: 'graphite' };

const TEXT_PAIRS = [
	['on-primary', 'primary'], ['on-primary-container', 'primary-container'],
	['on-secondary', 'secondary'], ['on-secondary-container', 'secondary-container'],
	['on-tertiary', 'tertiary'], ['on-tertiary-container', 'tertiary-container'],
	['on-error', 'error'], ['on-error-container', 'error-container'],
	['on-surface', 'surface'], ['on-surface', 'surface-container'], ['on-surface', 'surface-container-high'],
	['on-surface', 'surface-container-highest'], ['on-surface-variant', 'surface-container'],
	['inverse-on-surface', 'inverse-surface'],
];

test('every system color role resolves to a hex color', () => {
	const scheme = engine.generateColorScheme(BASE);
	assert.equal(Object.keys(scheme).length, engine.COLOR_ROLES.length);
	for (const role of engine.COLOR_ROLES) assert.match(scheme[role], HEX, role);
	for (const required of ['primary', 'on-primary', 'surface-container-highest', 'outline-variant', 'scrim', 'inverse-surface']) {
		assert.ok(required in scheme, required);
	}
});

test('text pairs meet WCAG AA (4.5:1) at standard contrast for every preset, variant, mode and surface', () => {
	for (const preset of presets.ACCENT_PRESETS) for (const variant of ['tonal_spot', 'vibrant', 'expressive', 'neutral'])
		for (const dark of [true, false]) for (const surface of ['graphite', 'tinted']) {
			const scheme = engine.generateColorScheme({ seed: preset.seed, dark, variant, contrast: 'standard', surface });
			for (const [fg, bg] of TEXT_PAIRS) {
				assert.ok(ratio(scheme[fg], scheme[bg]) >= 4.5,
					`${preset.id}/${variant}/${dark ? 'dark' : 'light'}/${surface}: ${fg} on ${bg} = ${ratio(scheme[fg], scheme[bg]).toFixed(2)}`);
			}
		}
});

test('high contrast reaches AAA (7:1) for primary text pairs', () => {
	for (const dark of [true, false]) {
		const scheme = engine.generateColorScheme({ ...BASE, dark, contrast: 'high' });
		for (const [fg, bg] of TEXT_PAIRS.filter(([, bg]) => bg !== 'surface-container-highest')) {
			assert.ok(ratio(scheme[fg], scheme[bg]) >= 7, `${dark ? 'dark' : 'light'} ${fg} on ${bg} = ${ratio(scheme[fg], scheme[bg]).toFixed(2)}`);
		}
	}
});

test('dark schemes are dark, light schemes are light, and containers step up in tone', () => {
	const dark = engine.generateColorScheme(BASE);
	const light = engine.generateColorScheme({ ...BASE, dark: false });
	assert.ok(luminance(dark.surface) < 0.02);
	assert.ok(luminance(light.surface) > 0.8);
	for (const scheme of [dark, light]) {
		const order = ['lowest', 'low', '', 'high', 'highest'].map(n => scheme['surface-container' + (n ? '-' + n : '')]);
		const lum = order.map(luminance);
		const direction = scheme === dark ? 1 : -1;
		for (let i = 1; i < lum.length; i++) assert.ok((lum[i] - lum[i - 1]) * direction >= 0, `container order ${order.join(',')}`);
	}
});

test('graphite surfaces are near-neutral, tinted surfaces carry the seed hue', () => {
	const spread = (hex) => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return Math.max(...c) - Math.min(...c); };
	const graphite = engine.generateColorScheme({ ...BASE, surface: 'graphite' });
	const tinted = engine.generateColorScheme({ ...BASE, surface: 'tinted' });
	assert.ok(spread(graphite['surface-container']) <= 6, graphite['surface-container']);
	assert.ok(spread(tinted['surface-container']) > spread(graphite['surface-container']));
	assert.equal(graphite.primary, tinted.primary, 'accent roles are identical across surface styles');
});

test('the seed hue drives the primary role', () => {
	const hue = (hex) => {
		const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
		const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
		if (!d) return 0;
		const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
		return (h * 60 + 360) % 360;
	};
	const blue = engine.generateColorScheme({ ...BASE, seed: '#3e90ff' });
	const green = engine.generateColorScheme({ ...BASE, seed: '#46b86b' });
	assert.ok(Math.abs(hue(blue.primary) - 215) < 25, blue.primary);
	assert.ok(Math.abs(hue(green.primary) - 140) < 30, green.primary);
});

test('parseHexColor accepts #rgb, #rrggbb, rrggbb and rrggbbaa and rejects everything else', () => {
	assert.equal(engine.parseHexColor('#ABC'), '#aabbcc');
	assert.equal(engine.parseHexColor('E9B979'), '#e9b979');
	assert.equal(engine.parseHexColor('#e9b97980'), '#e9b979');
	for (const bad of ['', '#12', '#12345', 'zzzzzz', '#1234567', null, undefined]) assert.equal(engine.parseHexColor(bad), null, String(bad));
	assert.throws(() => engine.generateColorScheme({ ...BASE, seed: 'nope' }));
});

test('viewport colors keep the grid visible against a stage darker than the panels', () => {
	for (const dark of [true, false]) {
		const scheme = engine.generateColorScheme({ ...BASE, dark });
		const viewport = engine.deriveViewportColors(scheme, dark);
		for (const value of Object.values(viewport)) assert.match(value, HEX);
		assert.ok(ratio(viewport.grid, viewport.stage) >= 1.4, `grid contrast ${ratio(viewport.grid, viewport.stage).toFixed(2)}`);
		assert.ok(ratio(viewport.wireframe, viewport.stage) >= 4.5, 'wireframe contrast');
		if (dark) assert.ok(luminance(viewport.stage) < luminance(scheme['surface-container']), 'stage is darker than panels');
	}
});

test('generated stylesheet defines every role, the legacy palette and the viewport colors', () => {
	const scheme = engine.generateColorScheme(BASE);
	const viewport = engine.deriveViewportColors(scheme, true);
	const sheet = css.buildThemeCss({ scheme, viewport, dark: true });
	assert.ok(sheet.startsWith('@layer theme {'));
	assert.equal(sheet.split('{').length, sheet.split('}').length);
	for (const role of engine.COLOR_ROLES) assert.ok(sheet.includes(`--md-sys-color-${role}: ${scheme[role]};`), role);
	for (const key of ['ui', 'back', 'dark', 'border', 'selected', 'elevated', 'button', 'bright_ui', 'accent', 'frame', 'text', 'light', 'accent_text', 'bright_ui_text', 'subtle_text', 'grid', 'wireframe', 'checkerboard']) {
		assert.match(sheet, new RegExp(`--color-${key}: #[0-9a-f]{6};`), key);
	}
	assert.ok(sheet.includes('color-scheme: dark;'));
	assert.ok(css.buildThemeCss({ scheme, viewport, dark: false }).includes('color-scheme: light;'));
});

test('stored appearance is validated field by field', () => {
	assert.deepEqual(model.sanitizeAppearance(null), model.DEFAULT_APPEARANCE);
	assert.deepEqual(model.sanitizeAppearance('garbage'), model.DEFAULT_APPEARANCE);
	const cleaned = model.sanitizeAppearance({ mode: 'neon', accent_source: 'system', accent_preset: 'blue', accent_custom: 'oops', variant: 'vibrant', contrast: 9, surface: 'tinted', glass: 'yes' });
	assert.equal(cleaned.mode, model.DEFAULT_APPEARANCE.mode);
	assert.equal(cleaned.accent_source, 'system');
	assert.equal(cleaned.accent_preset, 'blue');
	assert.equal(cleaned.accent_custom, model.DEFAULT_APPEARANCE.accent_custom);
	assert.equal(cleaned.variant, 'vibrant');
	assert.equal(cleaned.contrast, model.DEFAULT_APPEARANCE.contrast);
	assert.equal(cleaned.surface, 'tinted');
	assert.equal(cleaned.glass, true);
	assert.equal(model.sanitizeAppearance({ accent_custom: '#ABC' }).accent_custom, '#aabbcc');
});
