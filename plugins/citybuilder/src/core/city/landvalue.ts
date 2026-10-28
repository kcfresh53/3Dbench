import { clamp, fbm, saturate } from '../math';
import type { Lot } from '../lots/types';

/**
 * Scores every lot 0..1 from how central it is, how big the road in front of it is, how close it
 * is to water and a little noise. High value attracts taller, denser buildings.
 */
export function assignLandValue(lots: Lot[], waterLevel: number, seed: number): void {
	if (lots.length === 0) return;
	let cx: number = 0;
	let cz: number = 0;
	for (const l of lots) {
		cx += l.obb.cx;
		cz += l.obb.cz;
	}
	cx /= lots.length;
	cz /= lots.length;
	let radius: number = 1;
	for (const l of lots) radius = Math.max(radius, Math.hypot(l.obb.cx - cx, l.obb.cz - cz));
	for (const l of lots) {
		const centrality: number = 1 - Math.hypot(l.obb.cx - cx, l.obb.cz - cz) / radius;
		const road: number = saturate(l.roadLanes / 6);
		const shore: number = 1 - saturate((l.padHeight - waterLevel - 1) / 8);
		const noise: number = fbm(l.obb.cx / 90, l.obb.cz / 90, seed, 3);
		// Waterfront only counts when the lot is dry but close to the water line.
		const water: number = l.padHeight > waterLevel + 0.3 ? shore : 0;
		l.value = clamp(0.4 * Math.pow(centrality, 1.2) + 0.28 * road + 0.12 * water + 0.2 * noise, 0, 1);
	}
}
