import type { BudgetSettings, Carriageway, JunctionSettings, NetworkSettings, NodeOptions, SegmentData, StructureSettings } from './model';

export const DEFAULT_SETTINGS: NetworkSettings = {
	unitsPerMeter: 1,
	groundY: 0,
	defaultProfile: 'street',
	weather: 'spring',
	curveError: 0.2,
	seed: 1,
	junction: { cornerRadius: 4, stopLines: true, endCap: 'round', cornerSegments: 4, clearance: 4 },
	structures: { pierSpacing: 14, tunnelHeight: 6, bridgeThreshold: 1.5, tunnelThreshold: 2.5, fanSpacing: 36 },
	budget: { maxTriangles: 6000, enforce: false },
};

export const DEFAULT_CARRIAGEWAY: Carriageway = {
	lanes: 2,
	laneWidth: 3.25,
	medianWidth: 0,
	centerMarking: 'dashed',
	laneMarking: 'dashed',
	edgeLines: true,
	lineColor: 'white',
	surface: 'asphalt',
	crown: 0.05,
	crosswalks: 'zebra',
	medianBarrier: false,
};

export const DEFAULT_NODE: NodeOptions = { style: 'auto', cornerRadius: -1 };

export function defaultSegment(profile: string): SegmentData {
	return { profile, structure: 'auto', smooth: true, handleA: null, handleB: null };
}

export function mergeSettings(partial: Partial<NetworkSettings> | undefined): NetworkSettings {
	const base: NetworkSettings = DEFAULT_SETTINGS;
	return {
		...base,
		...partial,
		junction: { ...base.junction, ...partial?.junction },
		structures: { ...base.structures, ...partial?.structures },
		budget: { ...base.budget, ...partial?.budget },
	};
}

/** A change to network settings where nested groups only list the fields that change. */
export type SettingsPatch = Partial<Omit<NetworkSettings, 'junction' | 'structures' | 'budget'>> & {
	junction?: Partial<JunctionSettings>;
	structures?: Partial<StructureSettings>;
	budget?: Partial<BudgetSettings>;
};

export function applySettingsPatch(current: NetworkSettings, patch: SettingsPatch): NetworkSettings {
	return {
		...current,
		...patch,
		junction: { ...current.junction, ...patch.junction },
		structures: { ...current.structures, ...patch.structures },
		budget: { ...current.budget, ...patch.budget },
	};
}
