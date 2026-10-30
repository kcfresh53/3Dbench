import metadata from './ambientcg_manifest.json';
import { materialResource } from './asset_paths';
export type MaterialId = keyof typeof metadata;
export type MaterialChannel = 'albedo' | 'normal' | 'orm';
export const MATERIAL_IDS = Object.keys(metadata) as MaterialId[];
export const materialInfo = (id:MaterialId) => metadata[id];
export function materialSource(id:MaterialId, channel:MaterialChannel):string {
	return materialResource(metadata[id].maps[channel]);
}
export function materialPreviewSource(id:MaterialId, channel:MaterialChannel):string {
	return materialResource('preview/'+metadata[id].maps[channel]);
}
