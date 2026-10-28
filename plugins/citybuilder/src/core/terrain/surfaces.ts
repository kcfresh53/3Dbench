import { ByteGrid } from '../grid';
import { fbm, saturate, smoothstep } from '../math';
import { Heightfield } from './heightfield';

/** Ground materials. Index + 1 is the value stored in a paint grid; 0 means "decide automatically". */
export const SURFACES = ['grass', 'meadow', 'forest', 'dirt', 'sand', 'rock', 'snow', 'mud', 'paved', 'gravel'] as const;
export type SurfaceName = (typeof SURFACES)[number];

export const SURFACE_LABELS: Record<SurfaceName, string> = {
	grass: 'Grass',
	meadow: 'Dry meadow',
	forest: 'Forest floor',
	dirt: 'Loamy soil',
	sand: 'Beach / palms',
	rock: 'Rock',
	snow: 'Snow',
	mud: 'Mud',
	paved: 'Paved',
	gravel: 'Gravel',
};

/** Base colours (sRGB 0..255) for each surface. */
export const SURFACE_COLORS: Record<SurfaceName, [number, number, number]> = {
	grass: [92, 148, 66],
	meadow: [140, 156, 78],
	forest: [58, 98, 52],
	dirt: [128, 98, 68],
	sand: [214, 196, 140],
	rock: [124, 122, 118],
	snow: [236, 240, 244],
	mud: [92, 74, 56],
	paved: [150, 150, 152],
	gravel: [168, 160, 148],
};

export function surfaceId(name: SurfaceName): number {
	return SURFACES.indexOf(name) + 1;
}

export function surfaceName(id: number): SurfaceName | null {
	return id >= 1 && id <= SURFACES.length ? SURFACES[id - 1] : null;
}

export interface SurfaceRules {
	waterLevel: number;
	/** Height above the water where beaches end, metres. */
	beachHeight: number;
	/** Absolute height where snow starts, metres. */
	snowLine: number;
	/** Slope (rise/run) where grass turns to dirt. */
	dirtSlope: number;
	/** Slope where dirt turns to rock. */
	rockSlope: number;
	seed: number;
}

export const DEFAULT_RULES: SurfaceRules = { waterLevel: 0, beachHeight: 0.9, snowLine: 60, dirtSlope: 0.45, rockSlope: 0.9, seed: 5 };

/** Chooses the natural material of one cell. */
export function autoSurface(height: number, slope: number, x: number, z: number, rules: SurfaceRules): SurfaceName {
	if (height < rules.waterLevel - 0.05) return 'mud';
	if (height < rules.waterLevel + rules.beachHeight && slope < rules.dirtSlope) return 'sand';
	if (height > rules.snowLine && slope < rules.rockSlope) return 'snow';
	if (slope > rules.rockSlope) return 'rock';
	if (slope > rules.dirtSlope) return 'dirt';
	const n: number = fbm(x / 60, z / 60, rules.seed, 3);
	if (n > 0.66) return 'meadow';
	if (n < 0.28) return 'forest';
	return 'grass';
}

/** Per-cell surface ids (1-based) combining painted overrides with automatic rules. */
export function classifyCells(hf: Heightfield, paint: ByteGrid, rules: SurfaceRules): ByteGrid {
	const grid: ByteGrid = new ByteGrid(hf.cellCols, hf.cellRows);
	for (let r: number = 0; r < hf.cellRows; r++) {
		for (let c: number = 0; c < hf.cellCols; c++) {
			const painted: number = paint.get(c, r);
			if (painted > 0) {
				grid.set(c, r, painted);
				continue;
			}
			const x: number = hf.worldX(c) + hf.cellSize / 2;
			const z: number = hf.worldZ(r) + hf.cellSize / 2;
			const slope: number = cellSlope(hf, c, r);
			const height: number = (hf.get(c, r) + hf.get(c + 1, r) + hf.get(c, r + 1) + hf.get(c + 1, r + 1)) / 4;
			grid.set(c, r, surfaceId(autoSurface(height, slope, x, z, rules)));
		}
	}
	return grid;
}

/** Rise over run across one cell. */
export function cellSlope(hf: Heightfield, c: number, r: number): number {
	const h00: number = hf.get(c, r);
	const h10: number = hf.get(c + 1, r);
	const h01: number = hf.get(c, r + 1);
	const h11: number = hf.get(c + 1, r + 1);
	const dx: number = (h10 + h11 - h00 - h01) / (2 * hf.cellSize);
	const dz: number = (h01 + h11 - h00 - h10) / (2 * hf.cellSize);
	return Math.hypot(dx, dz);
}

/** 0 on dry land, 1 well below the water line. */
export function wetness(height: number, waterLevel: number): number {
	return saturate(smoothstep(waterLevel + 0.3, waterLevel - 1.2, height));
}
