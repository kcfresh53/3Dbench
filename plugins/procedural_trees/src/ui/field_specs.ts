import type { TreeParams } from '../core/types';

export interface FieldSpec {
	key: keyof TreeParams;
	label: string;
	type: 'number' | 'select' | 'checkbox' | 'color' | 'file';
	min?: number;
	max?: number;
	step?: number;
	integer?: boolean;
	options?: Record<string, string>;
	/** Select values that should be converted back to numbers. */
	numeric?: boolean;
	description?: string;
}

export type FormEntry = FieldSpec | { separator: string };

const TEXTURE_SIZES: Record<string, string> = {
	'64': '64 px',
	'128': '128 px',
	'256': '256 px',
	'512': '512 px',
	'1024': '1024 px',
};

export const FORM_ENTRIES: FormEntry[] = [
	{ separator: 'Trunk' },
	{ key: 'seed', label: 'Seed', type: 'number', min: 0, max: 99999, step: 1, integer: true },
	{ key: 'height', label: 'Height', type: 'number', min: 4, max: 1000, step: 1 },
	{ key: 'trunkThickness', label: 'Thickness (% of height)', type: 'number', min: 0.5, max: 15, step: 0.1 },
	{ key: 'trunkSides', label: 'Trunk sides', type: 'number', min: 3, max: 12, step: 1, integer: true },
	{ key: 'trunkSegments', label: 'Trunk segments', type: 'number', min: 3, max: 16, step: 1, integer: true },
	{ key: 'trunkTaper', label: 'Taper', type: 'number', min: 0, max: 1, step: 0.05 },
	{ key: 'rootFlare', label: 'Root flare', type: 'number', min: 0, max: 2, step: 0.05 },
	{ key: 'trunkBend', label: 'Trunk bend', type: 'number', min: 0, max: 1, step: 0.05 },
	{ separator: 'Branches' },
	{ key: 'branchLevels', label: 'Branch levels', type: 'number', min: 0, max: 3, step: 1, integer: true },
	{ key: 'branchCount', label: 'Branches per level', type: 'number', min: 2, max: 20, step: 1, integer: true, description: 'For palms, this is the number of crown fronds.' },
	{ key: 'branchStart', label: 'Bare trunk', type: 'number', min: 0, max: 0.9, step: 0.05 },
	{ key: 'branchAngle', label: 'Angle', type: 'number', min: 5, max: 120, step: 1 },
	{ key: 'branchLength', label: 'Length ratio', type: 'number', min: 0.1, max: 1.2, step: 0.05, description: 'For palms, frond length as a fraction of trunk height.' },
	{ key: 'branchThickness', label: 'Thickness ratio', type: 'number', min: 0.2, max: 0.9, step: 0.05 },
	{ key: 'branchBend', label: 'Branch bend', type: 'number', min: 0, max: 1, step: 0.05 },
	{ key: 'gravity', label: 'Gravity (- droop, + reach)', type: 'number', min: -1, max: 1, step: 0.05 },
	{
		key: 'crownShape',
		label: 'Crown shape',
		type: 'select',
		options: { round: 'Round', conical: 'Conical', columnar: 'Columnar', vase: 'Vase' },
	},
	{ separator: 'Foliage' },
	{
		key: 'foliageStyle',
		label: 'Style',
		type: 'select',
		options: { cards: 'Leaf cards', blobs: 'Low-poly blobs', tiers: 'Conifer tiers', fronds: 'Palm fronds', none: 'None' },
	},
	{ key: 'foliageSize', label: 'Size (% of height)', type: 'number', min: 2, max: 80, step: 0.5, description: 'For palms, leaflet span as a percentage of frond length.' },
	{
		key: 'foliageDensity',
		label: 'Density',
		type: 'number',
		min: 1,
		max: 12,
		step: 1,
		integer: true,
		description: 'Clusters per terminal branch, number of tiers, or leaflet density for palms.',
	},
	{ key: 'foliageStart', label: 'Foliage start', type: 'number', min: 0, max: 0.95, step: 0.05 },
	{ key: 'cardPlanes', label: 'Card planes', type: 'number', min: 1, max: 3, step: 1, integer: true },
	{
		key: 'blobDetail',
		label: 'Blob detail',
		type: 'select',
		numeric: true,
		options: { '0': 'Octahedron (8 tris)', '1': 'Icosahedron (15 tris)' },
	},
	{ separator: 'Look' },
	{
		key: 'leafKind',
		label: 'Leaf type',
		type: 'select',
		options: { broadleaf: 'Broadleaf', needle: 'Needle', palm: 'Palm' },
		description: 'Picks the procedural leaf card. Ignored when you supply a leaf image.',
	},
	{ key: 'barkColor', label: 'Bark colour', type: 'color' },
	{ key: 'leafColor', label: 'Leaf colour', type: 'color' },
	{ key: 'leafColor2', label: 'Leaf colour 2', type: 'color' },
	{ key: 'textureSize', label: 'Atlas size', type: 'select', numeric: true, options: TEXTURE_SIZES },
	{ separator: 'Texture slots' },
	{ key: 'useBundledTextures', label: 'Photographic defaults', type: 'checkbox', description: 'Bundled CC0 bark and foliage for realistic presets. Supplied images override these.' },
	{
		key: 'useCustomTextures',
		label: 'Use supplied images',
		type: 'checkbox',
		description: 'Untick to go back to the procedural paint without clearing the slots.',
	},
	{
		key: 'barkImage',
		label: 'Bark image',
		type: 'file',
		description: 'Tiled down the trunk (mirrored repeats). A seamless PNG/JPG works best.',
	},
	{
		key: 'leafImage',
		label: 'Leaf image',
		type: 'file',
		description: 'A branch or leaf cluster PNG with transparent background, used on foliage cards.',
	},
	{ separator: 'Game optimisation' },
	{
		key: 'maxTriangles',
		label: 'Triangle budget',
		type: 'number',
		min: 50,
		max: 20000,
		step: 50,
		integer: true,
		description: 'Detail is reduced automatically until the tree fits.',
	},
	{ key: 'lodCount', label: 'LOD count', type: 'number', min: 1, max: 3, step: 1, integer: true },
	{ key: 'spreadLods', label: 'Spread LODs for editing', type: 'checkbox', description: 'Off: LODs share an origin for engine export. Preview always shows LODs side by side.' },
	{
		key: 'separateFoliage',
		label: 'Separate foliage mesh',
		type: 'checkbox',
		description: 'Lets you use an opaque material for bark and alpha-test only for leaves.',
	},
];

export function isFieldSpec(entry: FormEntry): entry is FieldSpec {
	return 'key' in entry;
}
