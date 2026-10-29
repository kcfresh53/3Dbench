import type { Heightfield } from '../terrain/heightfield';

/** Water depth over the map, baked to a texture the water shader can read instead of a depth buffer. */
export interface WaterDepthMap {
	size: number;
	/** Depth in metres below the water line per texel, rows running from the map's smallest Z to its largest. 0 on land. */
	depths: Float32Array;
	/** Deepest point, metres. */
	maxDepth: number;
	/** True when any ground lies below the water line. */
	wet: boolean;
}

/**
 * Samples the terrain on a regular grid and stores how far each point lies below the water line. Finer than
 * the terrain grid, so a shore follows the slope rather than stepping with the vertices.
 */
export function buildWaterDepthMap(hf: Heightfield, waterLevel: number, size: number = 512): WaterDepthMap {
	const depths: Float32Array = new Float32Array(size * size);
	let maxDepth: number = 0;
	for (let j: number = 0; j < size; j++) {
		const z: number = hf.originZ + ((j + 0.5) / size) * hf.depth;
		for (let i: number = 0; i < size; i++) {
			const x: number = hf.originX + ((i + 0.5) / size) * hf.width;
			const d: number = Math.max(0, waterLevel - hf.sample(x, z));
			depths[j * size + i] = d;
			if (d > maxDepth) maxDepth = d;
		}
	}
	return { size, depths, maxDepth, wet: maxDepth > 0 };
}
