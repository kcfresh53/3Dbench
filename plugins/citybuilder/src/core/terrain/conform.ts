import { smoothstep } from '../math';
import type { RoadCorridor, RoadSample } from '../roads/corridor';
import type { Lot } from '../lots/types';
import { obbBounds, pointInObb } from '../geometry2d';
import { Heightfield } from './heightfield';

export interface ConformSettings {
	/** Cut or fill terrain under ground-level roads. */
	roadBlend: number;
	autoBridges: boolean;
	bridgeSpan: number;
	roads: boolean;
	/** Level the ground under every lot. */
	lots: boolean;
	/** The terrain sits this far below the road's top surface, metres. */
	roadBed: number;
	/** Horizontal run per metre of height difference for road embankments. */
	embankment: number;
	/** Blend ring around a levelled lot, metres. */
	lotBlend: number;
	/** Roads this close to the ground (metres, on average) count as ground-level instead of bridges or tunnels. */
	groundTolerance: number;
}

export const DEFAULT_CONFORM: ConformSettings = { roadBlend: 12, autoBridges: true, bridgeSpan: 8, roads: true, lots: true, roadBed: 0.12, embankment: 2.2, lotBlend: 5, groundTolerance: 10 };

export interface ConformResult {
	/** The terrain the city is built on. */
	heights: Heightfield;
	/** 0..1 per vertex: how much a road claims it. */
	roadWeight: Float32Array;
	/** 0..1 per vertex: how much a lot pad claims it. */
	lotWeight: Float32Array;
}

/**
 * Makes the ground follow the roads. Every vertex near a ground-level road is pulled to the road's
 * height inside the cross-section and eased back to the natural ground along an embankment.
 */
export function conformRoads(base: Heightfield, roads: RoadCorridor[], settings: ConformSettings): ConformResult {
	const heights: Heightfield = base.clone();
	const roadWeight: Float32Array = new Float32Array(base.heights.length);
	const lotWeight: Float32Array = new Float32Array(base.heights.length);
	if (!settings.roads) return { heights, roadWeight, lotWeight };
	const targets: Float32Array = new Float32Array(base.heights.length);
	const maxShoulder: number = Math.max(40, settings.roadBlend);
	const bestDistance = new Float32Array(base.heights.length).fill(Infinity);
	for (const road of roads) {
		if (road.structure !== 'ground') continue;
		const reach: number = Math.max(road.leftExtent, road.rightExtent);
		for (let i: number = 0; i + 1 < road.points.length; i++) {
			const a: RoadSample = road.points[i];
			const b: RoadSample = road.points[i + 1];
			const pad: number = reach + maxShoulder;
			const rect = base.rectAround((a.x + b.x) / 2, (a.z + b.z) / 2, Math.hypot(b.x - a.x, b.z - a.z) / 2 + pad);
			const dx: number = b.x - a.x;
			const dz: number = b.z - a.z;
			const len2: number = dx * dx + dz * dz;
			for (let r: number = rect.r0; r <= rect.r1; r++) {
				for (let c: number = rect.c0; c <= rect.c1; c++) {
					const px: number = base.worldX(c);
					const pz: number = base.worldZ(r);
					const t: number = len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / len2));
					const d: number = Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
					const side: number = dx * (pz - a.z) - dz * (px - a.x);
					const extent: number = side > 0 ? road.rightExtent : road.leftExtent;
					const target: number = a.y + (b.y - a.y) * t - settings.roadBed;
					const idx: number = base.index(c, r);
					const diff: number = Math.abs(target - base.heights[idx]);
					const shoulder: number = Math.min(maxShoulder, Math.max(base.cellSize * 2, settings.roadBlend, diff * settings.embankment));
					const w: number = d <= extent ? 1 : 1 - smoothstep(0, shoulder, d - extent);
					if (w > roadWeight[idx] || (w === roadWeight[idx] && d < bestDistance[idx])) {
						bestDistance[idx] = d;
						roadWeight[idx] = w;
						targets[idx] = target;
					}
				}
			}
		}
	}
	for (let i: number = 0; i < heights.heights.length; i++) {
		const w: number = roadWeight[i];
		if (w > 0) heights.heights[i] = base.heights[i] + (targets[i] - base.heights[i]) * w;
	}
	heights.touch();
	return { heights, roadWeight, lotWeight };
}

/** Levels the ground under each lot to its pad height, easing out over `lotBlend`. */
export function conformLots(result: ConformResult, lots: Lot[], settings: ConformSettings): ConformResult {
	if (!settings.lots) return result;
	const hf: Heightfield = result.heights;
	// Blend rings first, then lot interiors, so a neighbour's ring never undoes a pad.
	for (const pass of ['ring', 'inside'] as const) {
		for (const lot of lots) {
			const b = obbBounds(lot.obb);
			const rect = hf.rectAround((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + settings.lotBlend + hf.cellSize);
			for (let r: number = rect.r0; r <= rect.r1; r++) {
				for (let c: number = rect.c0; c <= rect.c1; c++) {
					const idx: number = hf.index(c, r);
					if (result.roadWeight[idx] >= 0.999) continue;
					const x: number = hf.worldX(c);
					const z: number = hf.worldZ(r);
					const dx: number = x - lot.obb.cx;
					const dz: number = z - lot.obb.cz;
					const along: number = Math.abs(dx * lot.obb.ux + dz * lot.obb.uz) - lot.obb.hw;
					const across: number = Math.abs(-dx * lot.obb.uz + dz * lot.obb.ux) - lot.obb.hd;
					const outside: number = Math.hypot(Math.max(along, 0), Math.max(across, 0));
					const inside: boolean = pointInObb(lot.obb, x, z, 0.5);
					if ((pass === 'inside') !== inside) continue;
					const w: number = inside ? 1 : 1 - smoothstep(0, Math.max(0.5, settings.lotBlend), outside);
					const weight: number = w * (1 - result.roadWeight[idx]);
					if (weight <= 0) continue;
					result.lotWeight[idx] = Math.max(result.lotWeight[idx], weight);
					hf.heights[idx] = hf.heights[idx] + (lot.padHeight - hf.heights[idx]) * weight;
				}
			}
		}
	}
	hf.touch();
	return result;
}
