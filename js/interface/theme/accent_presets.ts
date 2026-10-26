/** Seed colors offered in the appearance settings. The scheme variant decides how a seed becomes palettes. */
export const ACCENT_PRESETS = [
	{ id: 'amber', seed: '#e9b979' },
	{ id: 'orange', seed: '#ff8a3d' },
	{ id: 'red', seed: '#e5484d' },
	{ id: 'pink', seed: '#e8548f' },
	{ id: 'purple', seed: '#9b6bff' },
	{ id: 'indigo', seed: '#6071ff' },
	{ id: 'blue', seed: '#3e90ff' },
	{ id: 'cyan', seed: '#1fb9d4' },
	{ id: 'teal', seed: '#1fb5a3' },
	{ id: 'green', seed: '#46b86b' },
	{ id: 'lime', seed: '#a6c93a' },
] as const;

export type AccentPresetId = typeof ACCENT_PRESETS[number]['id'];
export const DEFAULT_ACCENT_PRESET: AccentPresetId = 'amber';

export function getPresetSeed(id: string): string {
	return (ACCENT_PRESETS.find(preset => preset.id === id) ?? ACCENT_PRESETS[0]).seed;
}
