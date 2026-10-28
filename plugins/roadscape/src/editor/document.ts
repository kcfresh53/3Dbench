import type { NetworkSettings, NodeOptions, RoadDocument, RoadNetwork, RoadProfile, RoadSegment, SegmentData } from '../core/model';
import { mergeSettings } from '../core/defaults';
import { BUILTIN_PROFILES } from '../core/profile_library';
import { DEFAULT_NODE, defaultSegment } from '../core/defaults';
import { NETWORK_KEY, LEGACY_LIVE_KEY } from './ids';

type Stored = Record<string, string>;

export function readStoredDocument(mesh: Mesh): RoadDocument | null {
	const raw: string | undefined = (mesh as unknown as Stored)[NETWORK_KEY];
	if (!raw) return null;
	try {
		const data: RoadDocument = JSON.parse(raw) as RoadDocument;
		if (data.version !== 3) return null;
		return { ...data, settings: mergeSettings(data.settings as Partial<NetworkSettings>) };
	} catch {
		return null;
	}
}

export function writeStoredDocument(mesh: Mesh, doc: RoadDocument): void {
	(mesh as unknown as Stored)[NETWORK_KEY] = JSON.stringify(doc);
}

export function hasNetwork(mesh: Mesh): boolean {
	return !!(mesh as unknown as Stored)[NETWORK_KEY] || !!(mesh as unknown as Stored)[LEGACY_LIVE_KEY];
}

export function emptyDocument(settings?: Partial<NetworkSettings>): RoadDocument {
	return { version: 3, settings: mergeSettings(settings), profiles: {}, segments: {}, nodes: {} };
}

/** Everything that must be saved: settings, edited profiles, per-segment and per-node data. */
export function documentFromNetwork(network: RoadNetwork): RoadDocument {
	const segments: Record<string, SegmentData> = {};
	for (const s of network.segments.values()) {
		segments[s.key] = { profile: s.profile, structure: s.structure, smooth: s.smooth, handleA: s.handleA, handleB: s.handleB };
	}
	const nodes: Record<string, NodeOptions> = {};
	for (const n of network.nodes.values()) {
		if (n.options.style !== DEFAULT_NODE.style || n.options.cornerRadius !== DEFAULT_NODE.cornerRadius) nodes[n.id] = { ...n.options };
	}
	const profiles: Record<string, RoadProfile> = {};
	const builtin: Set<string> = new Set(BUILTIN_PROFILES.map((p: RoadProfile): string => p.id));
	for (const [id, profile] of network.profiles) if (!builtin.has(id)) profiles[id] = profile;
	return { version: 3, settings: network.settings, profiles, segments, nodes };
}

/** Segment data to use for an edge the document has never seen (for example one made by extruding). */
export function segmentDefaults(neighbour: RoadSegment | null, fallbackProfile: string): SegmentData {
	if (!neighbour) return defaultSegment(fallbackProfile);
	return { ...defaultSegment(neighbour.profile), structure: neighbour.structure, smooth: neighbour.smooth };
}
