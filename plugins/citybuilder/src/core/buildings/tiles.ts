
/** Pixels per tile edge in the shared building atlas. Tiles are painted analytically, so this is only a sharpness budget. */
export const TILE_PX = 128;
/** The world size a tile is painted for in the shared atlas: one bay wide, one storey high, in metres. */
export const NOMINAL_TILE_M: [number, number] = [3, 3.2];

/**
 * Surface patterns a facade, roof or prop can use. Each is painted once per palette, so a
 * building's look is a palette index plus a handful of tile kinds.
 */
export const TILE_KINDS = [
	'wall',
	'window',
	'window_wide',
	'window_pair',
	'balcony',
	'shop_glass',
	'shop_door',
	'door',
	'garage',
	'panel',
	'panel_high',
	'curtain',
	'curtain_band',
	'roof_flat',
	'roof_tile',
	'roof_metal',
	'trim',
	'plinth',
	'metal',
	'awning',
	'sign',
	'brick',
	'helipad',
	'glass_tower',
	'glass_room',
] as const;
export type TileKind = (typeof TILE_KINDS)[number];

export interface Palette {
	name: string;
	wall: [number, number, number];
	trim: [number, number, number];
	accent: [number, number, number];
	roof: [number, number, number];
	glass: [number, number, number];
	frame: [number, number, number];
}

export const PALETTES: Palette[] = [
	{ name: 'Warm brick', wall: [168, 94, 72], trim: [226, 208, 178], accent: [48, 92, 84], roof: [112, 66, 56], glass: [86, 122, 150], frame: [60, 44, 38] },
	{ name: 'Red brick', wall: [150, 62, 52], trim: [214, 200, 182], accent: [34, 60, 88], roof: [78, 50, 48], glass: [74, 108, 138], frame: [44, 34, 32] },
	{ name: 'Sandstone', wall: [212, 184, 140], trim: [244, 234, 214], accent: [128, 74, 52], roof: [150, 92, 64], glass: [92, 130, 156], frame: [92, 72, 54] },
	{ name: 'White stucco', wall: [232, 228, 218], trim: [180, 172, 160], accent: [164, 72, 60], roof: [170, 84, 62], glass: [96, 134, 160], frame: [84, 80, 76] },
	{ name: 'Concrete', wall: [158, 158, 156], trim: [110, 110, 110], accent: [212, 142, 52], roof: [96, 98, 100], glass: [84, 116, 138], frame: [52, 54, 56] },
	{ name: 'Blue grey', wall: [132, 146, 160], trim: [90, 104, 118], accent: [220, 190, 80], roof: [84, 94, 106], glass: [104, 148, 176], frame: [46, 54, 62] },
	{ name: 'Cream', wall: [238, 224, 186], trim: [200, 176, 130], accent: [78, 118, 92], roof: [138, 98, 70], glass: [100, 136, 160], frame: [110, 90, 66] },
	{ name: 'Terracotta', wall: [204, 120, 82], trim: [236, 214, 184], accent: [60, 104, 110], roof: [140, 70, 48], glass: [90, 124, 146], frame: [80, 50, 40] },
	{ name: 'Sage', wall: [150, 168, 146], trim: [226, 226, 214], accent: [160, 84, 70], roof: [96, 106, 92], glass: [92, 128, 150], frame: [58, 70, 58] },
	{ name: 'Modern dark', wall: [70, 78, 88], trim: [38, 42, 48], accent: [92, 190, 220], roof: [52, 56, 62], glass: [60, 104, 136], frame: [26, 30, 34] },
	{ name: 'Ochre', wall: [214, 170, 82], trim: [240, 224, 180], accent: [112, 62, 44], roof: [134, 86, 52], glass: [90, 124, 146], frame: [92, 66, 36] },
	// Skyline looks: reflective blue and teal glass towers, bright white blocks, and low-rise with vivid roofs.
	{ name: 'Glass blue', wall: [128, 142, 160], trim: [196, 204, 214], accent: [60, 130, 200], roof: [96, 104, 114], glass: [104, 146, 176], frame: [176, 186, 198] },
	{ name: 'Glass teal', wall: [124, 148, 156], trim: [196, 210, 214], accent: [40, 160, 170], roof: [96, 108, 112], glass: [92, 148, 162], frame: [168, 184, 190] },
	{ name: 'Glass steel', wall: [118, 128, 144], trim: [184, 192, 204], accent: [180, 190, 205], roof: [90, 96, 106], glass: [128, 148, 170], frame: [160, 170, 184] },
	{ name: 'Skyline white', wall: [238, 240, 242], trim: [214, 218, 224], accent: [64, 140, 210], roof: [150, 156, 164], glass: [92, 160, 214], frame: [180, 186, 194] },
	{ name: 'Skyline sand', wall: [232, 222, 204], trim: [210, 200, 182], accent: [220, 120, 60], roof: [150, 140, 128], glass: [96, 150, 200], frame: [170, 160, 146] },
	{ name: 'Roof orange', wall: [236, 232, 224], trim: [250, 250, 248], accent: [220, 120, 50], roof: [236, 138, 44], glass: [90, 146, 196], frame: [120, 116, 110] },
	{ name: 'Roof teal', wall: [226, 232, 234], trim: [248, 250, 250], accent: [40, 150, 170], roof: [48, 160, 196], glass: [90, 146, 196], frame: [110, 118, 122] },
	{ name: 'Roof red', wall: [244, 238, 224], trim: [250, 248, 242], accent: [196, 64, 56], roof: [176, 66, 54], glass: [90, 146, 196], frame: [120, 112, 106] },
	{ name: 'Roof slate', wall: [214, 222, 228], trim: [244, 246, 248], accent: [92, 128, 170], roof: [86, 104, 128], glass: [90, 146, 196], frame: [96, 106, 118] },
];

export const PALETTE_COUNT = PALETTES.length;
export const TILE_COUNT = TILE_KINDS.length * PALETTE_COUNT;

/** A tile is `kindIndex * paletteCount + paletteIndex`. */
export type TileRef = number;

export function tileRef(kind: TileKind, palette: number): TileRef {
	return TILE_KINDS.indexOf(kind) * PALETTE_COUNT + (((palette % PALETTE_COUNT) + PALETTE_COUNT) % PALETTE_COUNT);
}

export function tileKind(ref: TileRef): TileKind {
	return TILE_KINDS[Math.floor(ref / PALETTE_COUNT)];
}

export function tilePalette(ref: TileRef): number {
	return ref % PALETTE_COUNT;
}

export interface PixelRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Whether a tile is see-through glass, which never hides what is behind it. */
export function isGlassKind(kind: TileKind): boolean {
	return kind === 'curtain' || kind === 'curtain_band' || kind === 'shop_glass';
}
