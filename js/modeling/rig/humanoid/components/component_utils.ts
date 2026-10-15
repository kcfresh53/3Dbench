import { BuildContext, MeshSpec } from '../humanoid_types';
import { LoftSettings } from '../chain_loft';

export function loftSettingsFor(context: BuildContext): LoftSettings {
	return {
		sides: context.landmarks.sides,
		blend: context.landmarks.weight_blend,
		rigid: context.params.style == 'blocky',
		mid_rings: context.params.style == 'smooth',
	};
}

export function emptyMeshes(): MeshSpec[] {
	return [];
}
