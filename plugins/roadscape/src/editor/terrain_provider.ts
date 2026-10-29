import type { RoadTerrain } from '../core/terrain_context';
export const TERRAIN_PROVIDER=Symbol.for('3dbench.roadscape.terrain');
export type TerrainProvider=(mesh:Mesh)=>RoadTerrain|undefined;
export function roadTerrain(mesh:Mesh):RoadTerrain|undefined {
	return (globalThis as unknown as Record<symbol,TerrainProvider|undefined>)[TERRAIN_PROVIDER]?.(mesh);
}
declare global { interface BlockbenchEventMap { citybuilder_terrain_changed: Record<string, never> } }
