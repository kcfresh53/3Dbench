import { districtById } from '../district/library';
import type { DistrictType } from '../district/types';
import type { ShapeKind } from '../buildings/types';
import type { PlacedBuilding } from './compose';

export interface CityStats {
	lots: number;
	buildings: number;
	trees: number;
	prefabs: number;
	population: number;
	jobs: number;
	floorArea: number;
	/** Buildings per district id. */
	byDistrict: Record<number, number>;
}

/** Share of the bounding rectangle that the shape actually covers, averaged over its floors. */
const FOOTPRINT_FACTOR: Record<ShapeKind, number> = { rect: 1, L: 0.75, U: 0.7, T: 0.7, podium: 0.85, stepped: 0.8 };

export function floorAreaOf(b: PlacedBuilding): number {
	return b.width * b.depth * FOOTPRINT_FACTOR[b.spec.shape] * b.spec.floors * 0.85;
}

export function computeStats(buildings: PlacedBuilding[], lotCount: number, treeCount: number, prefabCount: number): CityStats {
	const stats: CityStats = { lots: lotCount, buildings: buildings.length, trees: treeCount, prefabs: prefabCount, population: 0, jobs: 0, floorArea: 0, byDistrict: {} };
	for (const b of buildings) {
		const district: DistrictType | undefined = districtById(b.districtId);
		const area: number = floorAreaOf(b);
		stats.floorArea += area;
		if (district) {
			stats.population += area * district.residentsPerM2;
			stats.jobs += area * district.jobsPerM2;
		}
		stats.byDistrict[b.districtId] = (stats.byDistrict[b.districtId] ?? 0) + 1;
	}
	stats.population = Math.round(stats.population);
	stats.jobs = Math.round(stats.jobs);
	stats.floorArea = Math.round(stats.floorArea);
	return stats;
}
