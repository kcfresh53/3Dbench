import { materialInfo, materialPlate } from './ambientcg';
import type { MaterialId, MaterialChannel } from './ambientcg';
import type { Plate } from './library';
import { sampleStochastic } from './stochastic';
import type { Rgb } from '../core/raster';
import type { SurfaceName } from '../core/terrain/surfaces';

export const terrainMaterial: Record<SurfaceName, MaterialId> = {
 grass: 'grass', meadow: 'grass', forest: 'forest', dirt: 'dirt', sand: 'sand',
 rock: 'rock', snow: 'snow', mud: 'dirt', paved: 'paved', gravel: 'gravel',
};
export const terrainTint: Partial<Record<SurfaceName, Rgb>> = { meadow: [1.3, 1.12, 0.8], mud: [0.65, 0.63, 0.6] };
export interface TerrainTile { pixels: Uint8Array; tint: Rgb; plate: Plate; metres: number[]; channel:MaterialChannel }
export function terrainTile(name: SurfaceName, channel: MaterialChannel = 'albedo', pixelMetres: number = 0): TerrainTile {
 const id = terrainMaterial[name];
 const plate = materialPlate(id, channel, pixelMetres);
 return { pixels: plate.data, plate, channel, metres: materialInfo(id).metres, tint: channel === 'albedo' ? terrainTint[name] ?? [1, 1, 1] : [1, 1, 1] };
}
export function sampleTerrainTile(tile: TerrainTile, x: number, z: number, out: Float64Array, seed:number=0): void {
 sampleStochastic(tile.plate, x / tile.metres[0], z / tile.metres[1], tile.channel, out,seed);
 for (let i = 0; i < 3; i++) out[i] *= tile.tint[i];
}
export function terrainSample(name: SurfaceName, x: number, z: number, _fallback: Rgb): Rgb {
 const out = new Float64Array(3);
 const tile=terrainTile(name);
 sampleTerrainTile(tile,x,z,out);
 return [out[0],out[1],out[2]];
}
