import { cullHiddenFaces } from '../../../../roadscape/src/core/optimize/visibility_cull';
import { optimizeMesh } from '../../../../roadscape/src/core/optimize/mesh_optimizer';
import type { PropMesh } from '../types';
import { meshTriangles } from '../buildings/mesh';
import type { GameReadySettings } from './settings';

export interface ImportedLod {
	mesh: PropMesh;
	triangles: number;
}

export interface GameReadyResult {
	lods: ImportedLod[];
	trianglesBefore: number;
	removedHidden: number;
}

/**
 * Prepares an arbitrary mesh (a hand-made building, a prop) for a game: hidden faces are removed, then
 * successively coarser copies are simplified while the silhouette edges stay pinned.
 */
export function makeGameReady(mesh: PropMesh, settings: GameReadySettings, hemisphere: 'all' | 'up' = 'up'): GameReadyResult {
	const before: number = meshTriangles(mesh);
	const culled = cullHiddenFaces(mesh, { hemisphere });
	const base = optimizeMesh(culled.mesh, { maxError: settings.maxError, borderWeight: 8 });
	const lods: ImportedLod[] = [{ mesh: base.mesh, triangles: meshTriangles(base.mesh) }];
	if (settings.lods) {
		for (const ratio of settings.lodRatios) {
			const target: number = Math.max(12, Math.round(lods[0].triangles * ratio));
			const reduced = optimizeMesh(base.mesh, { maxError: settings.maxError, targetTriangles: target, hardMaxError: settings.maxError * 12, borderWeight: 8 });
			lods.push({ mesh: reduced.mesh, triangles: meshTriangles(reduced.mesh) });
		}
	}
	return { lods, trianglesBefore: before, removedHidden: culled.removed };
}
