import type { LiningElement, LiningType, Structure, TreeSpec } from './model';

export type LiningNumberKey =
	| 'offset'
	| 'spacing'
	| 'jitter'
	| 'scaleJitter'
	| 'scale'
	| 'height'
	| 'thickness'
	| 'density'
	| 'endMargin';

export interface LiningField {
	key: LiningNumberKey;
	label: string;
	min: number;
	max: number;
	step: number;
}

export interface LiningDefinition {
	type: LiningType;
	label: string;
	icon: string;
	/** Instanced linings repeat a prop; continuous linings sweep a shape along the road. */
	mode: 'instanced' | 'continuous';
	/** Library or procedural prop name for instanced linings and continuous post props. */
	prop: string;
	fields: LiningField[];
	hasPlacement: boolean;
	hasJunctionToggle: boolean;
	hasStagger: boolean;
	/** Structures this lining is drawn on. Trees on a bridge deck would float, for example. */
	structures: Structure[];
	/** Lower numbers are thinned first when a triangle budget has to be met. */
	thinOrder: number;
	/** Rotate every instance by a random angle (trees, rocks). */
	randomYaw: boolean;
	/** Stretch instances so they butt together along the road; the prop's own length in metres, or 0. */
	fitLength: number;
	defaults: Omit<LiningElement, 'kind' | 'id' | 'type' | 'tree'>;
}

export const DEFAULT_TREE: TreeSpec = { preset: 'oak_stylized', height: 7, variants: 4, maxTriangles: 150, seed: 11 };

const COMMON: Omit<LiningElement, 'kind' | 'id' | 'type' | 'tree'> = {
	enabled: true,
	placement: 'center',
	offset: 0,
	spacing: 20,
	jitter: 0,
	scaleJitter: 0,
	scale: 1,
	height: 1,
	thickness: 0.3,
	density: 1,
	endMargin: 2,
	atJunctions: false,
	stagger: false,
	seed: 1,
};

const ANY_STRUCTURE: Structure[] = ['ground', 'bridge', 'tunnel'];
const OPEN_AIR: Structure[] = ['ground', 'bridge'];

const SPACING: LiningField = { key: 'spacing', label: 'Spacing (m)', min: 0.5, max: 120, step: 0.5 };
const OFFSET: LiningField = { key: 'offset', label: 'Offset (m)', min: -10, max: 20, step: 0.1 };
const SCALE: LiningField = { key: 'scale', label: 'Scale', min: 0.2, max: 4, step: 0.05 };
const JITTER: LiningField = { key: 'jitter', label: 'Position jitter', min: 0, max: 1, step: 0.05 };
const SCALE_JITTER: LiningField = { key: 'scaleJitter', label: 'Size variation', min: 0, max: 0.8, step: 0.05 };
const DENSITY: LiningField = { key: 'density', label: 'Density', min: 0.05, max: 1, step: 0.05 };
const MARGIN: LiningField = { key: 'endMargin', label: 'End clearance (m)', min: 0, max: 40, step: 0.5 };
const HEIGHT: LiningField = { key: 'height', label: 'Height (m)', min: 0.2, max: 6, step: 0.05 };
const THICKNESS: LiningField = { key: 'thickness', label: 'Thickness (m)', min: 0.05, max: 3, step: 0.05 };

export const LINING_TYPES: Record<LiningType, LiningDefinition> = {
	lamp: {
		type: 'lamp',
		label: 'Street lamp',
		icon: 'lightbulb',
		mode: 'instanced',
		prop: 'RSEA Env Streetlight',
		fields: [SPACING, OFFSET, SCALE, MARGIN],
		hasPlacement: true,
		hasJunctionToggle: true,
		hasStagger: true,
		structures: OPEN_AIR,
		thinOrder: 3,
		randomYaw: false,
		fitLength: 0,
		defaults: { ...COMMON, spacing: 28, atJunctions: true, endMargin: 3 },
	},
	tree: {
		type: 'tree',
		label: 'Procedural tree',
		icon: 'park',
		mode: 'instanced',
		prop: '',
		fields: [SPACING, OFFSET, JITTER, SCALE_JITTER, DENSITY, MARGIN],
		hasPlacement: true,
		hasJunctionToggle: true,
		hasStagger: true,
		structures: ['ground'],
		thinOrder: 0,
		randomYaw: true,
		fitLength: 0,
		defaults: { ...COMMON, spacing: 11, jitter: 0.15, scaleJitter: 0.2, endMargin: 6, seed: 7 },
	},
	guardrail: {
		type: 'guardrail',
		label: 'Guardrail',
		icon: 'safety_divider',
		mode: 'continuous',
		prop: 'Guardrail Poles',
		fields: [OFFSET, SPACING, MARGIN],
		hasPlacement: true,
		hasJunctionToggle: false,
		hasStagger: false,
		structures: ANY_STRUCTURE,
		thinOrder: 4,
		randomYaw: false,
		fitLength: 0,
		defaults: { ...COMMON, placement: 'end', offset: 0.15, spacing: 4, endMargin: 0 },
	},
	barrier: {
		type: 'barrier',
		label: 'Concrete barrier',
		icon: 'fence',
		mode: 'instanced',
		prop: 'Jersey Barrier Concrete Grey Middle',
		fields: [OFFSET, SCALE, MARGIN],
		hasPlacement: true,
		hasJunctionToggle: false,
		hasStagger: false,
		structures: ANY_STRUCTURE,
		thinOrder: 5,
		randomYaw: false,
		fitLength: 1.6,
		defaults: { ...COMMON, placement: 'end', offset: 0.5, spacing: 1.6, endMargin: 0 },
	},
	bollard: {
		type: 'bollard',
		label: 'Bollards',
		icon: 'more_vert',
		mode: 'instanced',
		prop: 'Bollard',
		fields: [SPACING, OFFSET, SCALE, MARGIN],
		hasPlacement: true,
		hasJunctionToggle: false,
		hasStagger: false,
		structures: OPEN_AIR,
		thinOrder: 2,
		randomYaw: true,
		fitLength: 0,
		defaults: { ...COMMON, placement: 'start', spacing: 3, endMargin: 1.5 },
	},
	hedge: {
		type: 'hedge',
		label: 'Hedge',
		icon: 'grass',
		mode: 'continuous',
		prop: '',
		fields: [OFFSET, HEIGHT, THICKNESS],
		hasPlacement: true,
		hasJunctionToggle: false,
		hasStagger: false,
		structures: ['ground'],
		thinOrder: 6,
		randomYaw: false,
		fitLength: 0,
		defaults: { ...COMMON, height: 1, thickness: 0.7, endMargin: 0 },
	},
	fence: {
		type: 'fence',
		label: 'Fence',
		icon: 'view_week',
		mode: 'continuous',
		prop: '',
		fields: [OFFSET, HEIGHT, SPACING],
		hasPlacement: true,
		hasJunctionToggle: false,
		hasStagger: false,
		structures: OPEN_AIR,
		thinOrder: 6,
		randomYaw: false,
		fitLength: 0,
		defaults: { ...COMMON, height: 1.2, spacing: 2.5, thickness: 0.08, endMargin: 0 },
	},
	wall: {
		type: 'wall',
		label: 'Wall',
		icon: 'wall',
		mode: 'continuous',
		prop: '',
		fields: [OFFSET, HEIGHT, THICKNESS],
		hasPlacement: true,
		hasJunctionToggle: false,
		hasStagger: false,
		structures: ANY_STRUCTURE,
		thinOrder: 6,
		randomYaw: false,
		fitLength: 0,
		defaults: { ...COMMON, height: 1.5, thickness: 0.3, endMargin: 0 },
	},
	rock: {
		type: 'rock',
		label: 'Rocks',
		icon: 'landscape',
		mode: 'instanced',
		prop: 'RSEA Rock Small',
		fields: [SPACING, OFFSET, JITTER, SCALE_JITTER, SCALE, DENSITY, MARGIN],
		hasPlacement: true,
		hasJunctionToggle: false,
		hasStagger: false,
		structures: ['ground'],
		thinOrder: 1,
		randomYaw: true,
		fitLength: 0,
		defaults: { ...COMMON, spacing: 9, jitter: 0.8, scaleJitter: 0.6, scale: 2.5, density: 0.7, endMargin: 3, seed: 3 },
	},
	marker: {
		type: 'marker',
		label: 'Road studs',
		icon: 'more_horiz',
		mode: 'instanced',
		prop: 'Raised Pavement Marker',
		fields: [SPACING, OFFSET, SCALE, MARGIN],
		hasPlacement: true,
		hasJunctionToggle: false,
		hasStagger: false,
		structures: ANY_STRUCTURE,
		thinOrder: 2,
		randomYaw: false,
		fitLength: 0,
		defaults: { ...COMMON, placement: 'start', offset: -0.25, spacing: 6, scale: 1.5, endMargin: 1 },
	},
};

export const LINING_ORDER: LiningType[] = ['lamp', 'tree', 'guardrail', 'barrier', 'bollard', 'hedge', 'fence', 'wall', 'rock', 'marker'];

export function makeLining(type: LiningType, id: string, overrides: Partial<LiningElement> = {}): LiningElement {
	const def: LiningDefinition = LINING_TYPES[type];
	return { kind: 'lining', id, type, tree: { ...DEFAULT_TREE }, ...def.defaults, ...overrides };
}
