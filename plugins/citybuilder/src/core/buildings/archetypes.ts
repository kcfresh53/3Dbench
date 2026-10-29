import type { FacadeStyle, RoofKind, RoofProp, ShapeKind } from './types';

export interface Archetype {
	id: string;
	label: string;
	style: FacadeStyle;
	shapes: Array<[ShapeKind, number]>;
	roofs: Array<[RoofKind, number]>;
	bay: number;
	floorHeight: number;
	groundHeight: number;
	/** Storeys this kind of building can have. */
	floors: [number, number];
	/** Footprint size range in bays. */
	baysX: [number, number];
	baysZ: [number, number];
	frontSetback: number;
	sideSetback: number;
	backSetback: number;
	shopfront: boolean;
	/** Chance of a shop awning. */
	awning: number;
	/** Chance of balconies. */
	balconies: number;
	parapet: boolean;
	/** Rooftop extras and the chance each one appears. */
	props: Array<[RoofProp, number]>;
	pitch: [number, number];
}

const HOUSE: Archetype = {
	id: 'house',
	label: 'House',
	style: 'house',
	shapes: [['rect', 5], ['L', 2]],
	roofs: [['gable', 4], ['hip', 2]],
	bay: 3,
	floorHeight: 2.9,
	groundHeight: 3,
	floors: [1, 2],
	baysX: [3, 5],
	baysZ: [3, 5],
	frontSetback: 2.5,
	sideSetback: 1.5,
	backSetback: 2,
	shopfront: false,
	awning: 0,
	balconies: 0,
	parapet: false,
	props: [['chimney', 0.5]],
	pitch: [28, 38],
};

export const ARCHETYPES: Archetype[] = [
	HOUSE,
	{
		...HOUSE,
		id: 'row_house',
		label: 'Row house',
		style: 'apartment',
		shapes: [['rect', 1]],
		roofs: [['flat', 3], ['shed', 1]],
		bay: 3.2,
		floorHeight: 3,
		groundHeight: 3.4,
		floors: [2, 4],
		baysX: [4, 7],
		baysZ: [3, 4],
		frontSetback: 1.5,
		sideSetback: 0.5,
		parapet: true,
		props: [['vent', 0.5]],
		pitch: [8, 14],
	},
	{
		...HOUSE,
		id: 'apartment',
		label: 'Apartment block',
		style: 'apartment',
		shapes: [['rect', 4], ['L', 2], ['U', 1]],
		roofs: [['flat', 1]],
		bay: 3.2,
		floorHeight: 3.1,
		groundHeight: 3.6,
		floors: [3, 10],
		baysX: [5, 8],
		baysZ: [4, 7],
		frontSetback: 2,
		sideSetback: 1,
		backSetback: 2,
		balconies: 0.6,
		parapet: true,
		props: [['hvac', 0.7], ['tank', 0.3], ['vent', 0.5]],
		pitch: [0, 0],
	},
	{
		...HOUSE,
		id: 'tower_res',
		label: 'Residential tower',
		style: 'apartment',
		shapes: [['podium', 2], ['stepped', 1], ['rect', 2]],
		roofs: [['flat', 1]],
		bay: 3.4,
		floorHeight: 3.1,
		groundHeight: 4,
		floors: [8, 28],
		baysX: [5, 8],
		baysZ: [5, 8],
		frontSetback: 3,
		sideSetback: 2,
		backSetback: 3,
		balconies: 0.8,
		parapet: true,
		props: [['hvac', 0.8], ['tank', 0.5], ['antenna', 0.5]],
		pitch: [0, 0],
	},
	{
		...HOUSE,
		id: 'shop',
		label: 'Shop',
		style: 'shop',
		shapes: [['rect', 1]],
		roofs: [['flat', 1]],
		bay: 3.4,
		floorHeight: 3.3,
		groundHeight: 4.2,
		floors: [1, 3],
		baysX: [3, 5],
		baysZ: [4, 6],
		frontSetback: 0.5,
		sideSetback: 0,
		backSetback: 1.5,
		shopfront: true,
		awning: 0.7,
		parapet: true,
		props: [['hvac', 0.6], ['vent', 0.5]],
		pitch: [0, 0],
	},
	{
		...HOUSE,
		id: 'mixed_block',
		label: 'Mixed-use block',
		style: 'shop',
		shapes: [['rect', 4], ['L', 1]],
		roofs: [['flat', 1]],
		bay: 3.3,
		floorHeight: 3.1,
		groundHeight: 4.2,
		floors: [3, 9],
		baysX: [4, 7],
		baysZ: [4, 6],
		frontSetback: 0.5,
		sideSetback: 0,
		backSetback: 2,
		shopfront: true,
		awning: 0.5,
		balconies: 0.6,
		parapet: true,
		props: [['hvac', 0.8], ['tank', 0.3]],
		pitch: [0, 0],
	},
	{
		...HOUSE,
		id: 'mid_commercial',
		label: 'Commercial block',
		style: 'shop',
		shapes: [['rect', 3], ['L', 1], ['podium', 1]],
		roofs: [['flat', 1]],
		bay: 3.6,
		floorHeight: 3.5,
		groundHeight: 4.6,
		floors: [3, 10],
		baysX: [5, 8],
		baysZ: [4, 7],
		frontSetback: 0.5,
		sideSetback: 0,
		backSetback: 2,
		shopfront: true,
		awning: 0.5,
		parapet: true,
		props: [['hvac', 0.9], ['vent', 0.5]],
		pitch: [0, 0],
	},
	{
		...HOUSE,
		id: 'office_mid',
		label: 'Office block',
		style: 'curtain',
		shapes: [['rect', 3], ['L', 1], ['podium', 1]],
		roofs: [['flat', 3], ['shed', 1]],
		bay: 3.6,
		floorHeight: 3.6,
		groundHeight: 5,
		floors: [5, 20],
		baysX: [5, 9],
		baysZ: [5, 9],
		frontSetback: 1,
		sideSetback: 0.4,
		backSetback: 1,
		parapet: true,
		props: [['hvac', 0.9], ['vent', 0.4]],
		pitch: [0, 0],
	},
	{
		...HOUSE,
		id: 'office_tower',
		label: 'Office tower',
		style: 'curtain',
		shapes: [['podium', 3], ['stepped', 3], ['rect', 2]],
		roofs: [['flat', 3], ['hip', 1], ['shed', 2]],
		bay: 3.8,
		floorHeight: 3.7,
		groundHeight: 6,
		floors: [16, 60],
		baysX: [6, 10],
		baysZ: [6, 10],
		frontSetback: 1.5,
		sideSetback: 0.5,
		backSetback: 1.5,
		parapet: true,
		props: [['hvac', 0.8], ['spire', 0.35], ['antenna', 0.4]],
		pitch: [12, 30],
	},
	{
		...HOUSE,
		id: 'warehouse',
		label: 'Warehouse',
		style: 'industrial',
		shapes: [['rect', 1]],
		roofs: [['shed', 2], ['flat', 1], ['gable', 1]],
		bay: 4.5,
		floorHeight: 5.5,
		groundHeight: 6.5,
		floors: [1, 2],
		baysX: [5, 9],
		baysZ: [4, 7],
		frontSetback: 4,
		sideSetback: 3,
		backSetback: 4,
		parapet: false,
		props: [['vent', 0.6], ['hvac', 0.4]],
		pitch: [8, 14],
	},
	{
		...HOUSE,
		id: 'factory',
		label: 'Factory',
		style: 'industrial',
		shapes: [['rect', 2], ['L', 2], ['T', 1]],
		roofs: [['flat', 2], ['shed', 1]],
		bay: 4.5,
		floorHeight: 5.5,
		groundHeight: 6.5,
		floors: [1, 3],
		baysX: [5, 9],
		baysZ: [4, 8],
		frontSetback: 5,
		sideSetback: 3,
		backSetback: 5,
		parapet: true,
		props: [['chimney', 0.75], ['tank', 0.6], ['hvac', 0.6], ['vent', 0.5]],
		pitch: [8, 12],
	},
	{
		...HOUSE,
		id: 'civic_hall',
		label: 'Civic building',
		style: 'civic',
		shapes: [['rect', 2], ['U', 1], ['T', 1]],
		roofs: [['hip', 3], ['flat', 1]],
		bay: 3.6,
		floorHeight: 3.8,
		groundHeight: 4.4,
		floors: [1, 4],
		baysX: [6, 9],
		baysZ: [4, 7],
		frontSetback: 5,
		sideSetback: 3,
		backSetback: 4,
		parapet: true,
		props: [['vent', 0.4]],
		pitch: [20, 28],
	},
];

// Separate families preserve each silhouette when the prefab budget is reached.
const tower = ARCHETYPES.find(a => a.id === 'office_tower') as Archetype;
for (const [id, label, shape] of [
	['office_round', 'Elliptical glass tower', 'rounded'],
	['office_chamfer', 'Chamfered glass tower', 'chamfered'],
	['office_taper', 'Tapered landmark', 'tapered'],
	['office_sail', 'Swept sail landmark', 'sail'],
] as Array<[string, string, ShapeKind]>) {
	ARCHETYPES.push({ ...tower, id, label, shapes: [[shape, 1]], roofs: shape === 'rounded' ? [['flat', 3], ['shed', 1]] : [['flat', 1]], floors: [16, 64], props: [], pitch: [0, 0], ...(shape === 'sail' ? { floors: [38, 72] as [number, number], baysX: [10, 14] as [number, number], baysZ: [4, 6] as [number, number] } : {}) });
}

ARCHETYPES.push({ ...tower, id: 'wind_turbine', label: 'Wind turbine', style: 'industrial',
	shapes: [['rect', 1]], roofs: [['flat', 1]], bay: 12, floors: [1, 1], baysX: [5, 5], baysZ: [5, 5],
	frontSetback: 4, sideSetback: 4, backSetback: 4, shopfront: false, props: [], pitch: [0, 0] });

ARCHETYPES.push({ ...HOUSE, id: 'modern_villa', label: 'Modern flat-roof villa',
	shapes: [['rect', 3], ['L', 2]], roofs: [['flat', 1]], parapet: true, props: [['vent', .3]], pitch: [0, 0] });

const BY_ID: Map<string, Archetype> = new Map(ARCHETYPES.map((a: Archetype): [string, Archetype] => [a.id, a]));

export function archetypeById(id: string): Archetype | undefined {
	return BY_ID.get(id);
}
