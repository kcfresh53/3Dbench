import { fbm, lerp, smoothstep } from '../math';
import type { Heightfield } from './heightfield';

/** Bends the edges of a landscape down into the sea so the map reads as an island. */
export interface IslandOptions {
	/** How far in from the border the slope begins, as a share of the map half-size (0.05 to 0.7). */
	width: number;
	/** How far below the water line the sea floor lies at the border, metres. */
	depth: number;
	/** How ragged the coastline is, 0 (smooth) to 1 (bays and headlands). */
	roughness: number;
	/** `round` makes a circular island, `rounded square` keeps more of the corners. */
	shape: 'round' | 'rounded square';
	seed: number;
}

export const DEFAULT_ISLAND: IslandOptions = { width: 0.35, depth: 12, roughness: 0.5, shape: 'round', seed: 11 };

/**
 * Pulls the ground near the map edge below the water level, with a noisy coastline. Land that is already
 * lower than the sea floor is left alone, so the operation never raises anything. Deterministic.
 */
export function applyIsland(hf: Heightfield, waterLevel: number, options: IslandOptions): void {
	const halfW: number = Math.max(1, hf.width / 2);
	const halfD: number = Math.max(1, hf.depth / 2);
	const cx: number = hf.originX + halfW;
	const cz: number = hf.originZ + halfD;
	const inner: number = 1 - Math.max(0.05, Math.min(0.7, options.width));
	const floor: number = waterLevel - Math.max(0.5, options.depth);
	const power: number = options.shape === 'round' ? 2 : 4;
	for (let r: number = 0; r < hf.rows; r++) {
		for (let c: number = 0; c < hf.cols; c++) {
			const x: number = hf.worldX(c);
			const z: number = hf.worldZ(r);
			const nx: number = Math.abs((x - cx) / halfW);
			const nz: number = Math.abs((z - cz) / halfD);
			const distance: number = Math.pow(Math.pow(nx, power) + Math.pow(nz, power), 1 / power);
			const ragged: number = (fbm(x / 180, z / 180, options.seed, 4) - 0.5) * options.roughness * 0.7;
			const f: number = smoothstep(inner, 1, distance + ragged);
			const index: number = hf.index(c, r);
			hf.heights[index] = Math.min(hf.heights[index], lerp(hf.heights[index], floor, f));
		}
	}
	hf.touch();
}
