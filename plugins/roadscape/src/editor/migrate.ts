import type { RoadDocument, RoadProfile } from '../core/model';
import { forkProfile } from '../core/profile_edit';
import { builtinProfile } from '../core/profile_library';
import { emptyDocument } from './document';
import { edgesOf } from './network_mesh';
import { edgeKey } from '../core/model';
import { LEGACY_LIVE_KEY } from './ids';

interface LegacyParams {
	preset?: string;
	width?: number;
	lanes?: number;
	scale?: number;
	weather?: 'spring' | 'wet' | 'snow';
	smoothPath?: boolean;
	curveError?: number;
	maxTriangles?: number;
}

const PRESET_TO_PROFILE: Record<string, string> = {
	urban: 'street',
	highway: 'highway',
	bridge: 'bridge_road',
	tunnel: 'tunnel_road',
	race: 'race',
	trail: 'trail',
};

/**
 * Turns a version 2 live road (one path with a single parameter set) into a network document.
 * The old road style becomes a road profile; the path edges become segments.
 */
export function migrateLegacyRoad(mesh: Mesh): RoadDocument | null {
	const raw: string | undefined = (mesh as unknown as Record<string, string>)[LEGACY_LIVE_KEY];
	if (!raw) return null;
	let params: LegacyParams;
	try {
		params = (JSON.parse(raw) as { params?: LegacyParams }).params ?? {};
	} catch {
		return null;
	}
	const doc: RoadDocument = emptyDocument({
		unitsPerMeter: params.scale && params.scale > 0 ? params.scale : 1,
		weather: params.weather ?? 'spring',
		curveError: params.curveError && params.curveError > 0 ? params.curveError : 0.2,
		budget: { maxTriangles: params.maxTriangles ?? 6000, enforce: !!params.maxTriangles },
	});
	let profileId: string = PRESET_TO_PROFILE[params.preset ?? 'urban'] ?? 'street';
	const base: RoadProfile | undefined = builtinProfile(profileId);
	if (base && params.lanes && params.width && params.lanes >= 1) {
		const custom: RoadProfile = forkProfile(base, `legacy-${profileId}`, `${base.name} (migrated)`);
		custom.carriageway = { ...custom.carriageway, lanes: Math.round(params.lanes), laneWidth: Math.max(2, params.width / params.lanes) };
		doc.profiles[custom.id] = custom;
		profileId = custom.id;
	}
	doc.settings.defaultProfile = profileId;
	for (const [a, b] of edgesOf(mesh)) {
		doc.segments[edgeKey(a, b)] = { profile: profileId, structure: 'auto', smooth: params.smoothPath !== false, handleA: null, handleB: null };
	}
	return doc;
}
