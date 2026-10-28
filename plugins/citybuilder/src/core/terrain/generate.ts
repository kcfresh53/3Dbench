import { fbm, lerp, ridged, saturate, smoothstep } from '../math';
import { Heightfield } from './heightfield';

export type TerrainPreset = 'flat' | 'rolling' | 'valley' | 'coast' | 'island' | 'mountains' | 'terraces';

export interface GenerateOptions {
	preset: TerrainPreset;
	seed: number;
	/** Vertical range of the features, metres. */
	amplitude: number;
	/** Wavelength of the largest features, metres. */
	scale: number;
	/** Height of the flat base, metres. */
	baseHeight: number;
}

export const DEFAULT_GENERATE: GenerateOptions = { preset: 'rolling', seed: 3, amplitude: 14, scale: 220, baseHeight: 2 };

export const TERRAIN_PRESETS: Array<{ id: TerrainPreset; label: string }> = [
	{ id: 'flat', label: 'Flat plain' },
	{ id: 'rolling', label: 'Rolling hills' },
	{ id: 'valley', label: 'River valley' },
	{ id: 'coast', label: 'Coastline' },
	{ id: 'island', label: 'Island' },
	{ id: 'mountains', label: 'Mountains' },
	{ id: 'terraces', label: 'Terraced hills' },
];

/** Replaces every height with a procedural landscape. Deterministic for a given option set. */
export function generateTerrain(hf: Heightfield, partial: Partial<GenerateOptions> = {}): void {
	const o: GenerateOptions = { ...DEFAULT_GENERATE, ...partial };
	const halfW: number = Math.max(1, hf.width / 2);
	const halfD: number = Math.max(1, hf.depth / 2);
	for (let r: number = 0; r < hf.rows; r++) {
		for (let c: number = 0; c < hf.cols; c++) {
			const x: number = hf.worldX(c);
			const z: number = hf.worldZ(r);
			const nx: number = x / halfW;
			const nz: number = z / halfD;
			const base: number = fbm(x / o.scale, z / o.scale, o.seed, 5);
			let h: number = o.baseHeight;
			switch (o.preset) {
				case 'flat':
					h += base * 0.6;
					break;
				case 'rolling':
					h += (base - 0.35) * o.amplitude * 1.6;
					break;
				case 'valley': {
					// A meandering channel along X with hills rising on both banks.
					const meander: number = Math.sin(nx * 2.2 + o.seed) * 0.18 + (fbm(x / (o.scale * 1.4), 0, o.seed + 9, 3) - 0.5) * 0.3;
					const across: number = Math.abs(nz - meander);
					const bank: number = smoothstep(0.04, 0.7, across);
					h += -o.amplitude * 0.35 + bank * o.amplitude * 1.3 + (base - 0.5) * o.amplitude * 0.5 * bank;
					break;
				}
				case 'coast': {
					const shore: number = nx * 0.9 + (fbm(x / (o.scale * 0.8), z / (o.scale * 0.8), o.seed + 5, 4) - 0.5) * 0.9;
					const land: number = smoothstep(-0.55, 0.45, shore);
					h += lerp(-o.amplitude * 0.5, o.amplitude * 0.5, land) + (base - 0.5) * o.amplitude * 0.7 * land;
					break;
				}
				case 'island': {
					const edge: number = saturate(1 - Math.hypot(nx, nz) * 1.05 + (fbm(x / (o.scale * 0.7), z / (o.scale * 0.7), o.seed + 2, 4) - 0.5) * 0.5);
					const dome: number = smoothstep(0.05, 0.75, edge);
					h += -o.amplitude * 0.45 + dome * o.amplitude * 1.2 + (base - 0.5) * o.amplitude * 0.5 * dome;
					break;
				}
				case 'mountains': {
					const ridge: number = ridged(x / o.scale, z / o.scale, o.seed, 5);
					h += ridge * o.amplitude * 2.4 + (base - 0.5) * o.amplitude * 0.6;
					break;
				}
				case 'terraces': {
					const raw: number = (base - 0.3) * o.amplitude * 2;
					const stepSize: number = Math.max(1, o.amplitude / 5);
					const stepped: number = Math.round(raw / stepSize) * stepSize;
					h += lerp(raw, stepped, 0.8);
					break;
				}
			}
			hf.heights[hf.index(c, r)] = h;
		}
	}
	hf.touch();
}
