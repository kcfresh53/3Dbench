export interface CityStats {
	lots: number;
	buildings: number;
	trees: number;
	prefabs: number;
}

export function computeStats(buildingCount: number, lotCount: number, treeCount: number, prefabCount: number): CityStats {
	return { lots: lotCount, buildings: buildingCount, trees: treeCount, prefabs: prefabCount };
}
