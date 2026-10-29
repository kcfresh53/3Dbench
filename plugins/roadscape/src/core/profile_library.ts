import type { Carriageway, LiningElement, RoadProfile, SideElement, StripElement } from './model';
import { DEFAULT_CARRIAGEWAY } from './defaults';
import { makeLining } from './lining_library';
import { makeStrip } from './strip_library';

type SideSpec = Array<StripElement | LiningElement>;

function build(
	id: string,
	name: string,
	carriageway: Partial<Carriageway>,
	side: (suffix: string) => SideSpec,
	structure: RoadProfile['structure'] = 'auto',
	support?: RoadProfile['support'],
): RoadProfile {
	const stamp = (elements: SideSpec, suffix: string): SideElement[] =>
		elements.map((e: StripElement | LiningElement, i: number): SideElement => ({ ...e, id: `${id}.${suffix}${i}` }));
	return {
		id,
		name,
		carriageway: { ...DEFAULT_CARRIAGEWAY, ...carriageway },
		left: stamp(side('l'), 'l'),
		right: stamp(side('r'), 'r'),
		structure,
		...(support ? { support } : {}),
		builtin: true,
	};
}

const strip = (type: StripElement['type'], overrides: Partial<StripElement> = {}): StripElement => makeStrip(type, '', overrides);
const lining = (type: LiningElement['type'], overrides: Partial<LiningElement> = {}): LiningElement => makeLining(type, '', overrides);

/** Built-in road types. Everything here is plain data: edit one in the panel to make a project copy. */
export const BUILTIN_PROFILES: RoadProfile[] = [
	build('street', 'Urban street', {}, (): SideSpec => [strip('gutter'), strip('curb'), strip('sidewalk', { width: 2.2 }), lining('lamp')]),
	build('tree_street', 'Tree-lined street', {}, (): SideSpec => [
		strip('gutter'),
		strip('curb'),
		strip('verge', { width: 1.8 }),
		lining('tree', { spacing: 10 }),
		strip('sidewalk', { width: 2.2 }),
		lining('lamp', { spacing: 30, offset: 0 }),
	]),
	build('avenue', 'Avenue', { lanes: 4, medianWidth: 3, centerMarking: 'none', laneMarking: 'dashed' }, (): SideSpec => [
		strip('gutter'),
		strip('curb'),
		strip('verge', { width: 2 }),
		lining('tree', { spacing: 9 }),
		strip('sidewalk', { width: 2.6 }),
		lining('lamp', { spacing: 28 }),
	]),
	build(
		'highway',
		'Highway',
		{ lanes: 4, laneWidth: 3.6, medianWidth: 1.2, medianBarrier: true, centerMarking: 'solid', crosswalks: 'none', lineColor: 'white' },
		(): SideSpec => [strip('shoulder', { width: 2.5 }), lining('guardrail', { placement: 'end', offset: 0.2 }), strip('verge', { width: 3, top: -0.05 })],
	),
	build('one_way', 'One-way street', { lanes: 2, centerMarking: 'none', laneMarking: 'dashed', crosswalks: 'zebra', oneWay: true }, (): SideSpec => [strip('gutter'), strip('curb'), strip('sidewalk', { width: 2.2 }), lining('lamp')]),
	build(
		'boulevard',
		'Boulevard',
		{ lanes: 6, laneWidth: 3.3, medianWidth: 5, centerMarking: 'none', laneMarking: 'dashed' },
		(): SideSpec => [strip('gutter'), strip('curb'), strip('verge', { width: 2.4 }), lining('tree', { spacing: 10 }), strip('sidewalk', { width: 3 }), lining('lamp', { spacing: 28 })],
	),
	build(
		'highway_small',
		'Highway, two lanes',
		{ lanes: 2, laneWidth: 3.6, centerMarking: 'double', crosswalks: 'none', lineColor: 'white' },
		(): SideSpec => [strip('shoulder', { width: 2.2 }), lining('guardrail', { placement: 'end', offset: 0.2 }), strip('verge', { width: 3, top: -0.05 })],
	),
	build(
		'highway_one_way',
		'Highway, one direction',
		{ lanes: 3, laneWidth: 3.6, centerMarking: 'none', laneMarking: 'dashed', crosswalks: 'none', oneWay: true },
		(): SideSpec => [strip('shoulder', { width: 2.4 }), lining('guardrail', { placement: 'end', offset: 0.2 }), strip('verge', { width: 3, top: -0.05 })],
	),
	build(
		'viaduct',
		'Elevated highway (cantilever)',
		{ lanes: 4, laneWidth: 3.6, medianWidth: 1.2, medianBarrier: true, centerMarking: 'solid', crosswalks: 'none' },
		(): SideSpec => [strip('shoulder', { width: 1.8 }), lining('barrier', { placement: 'end', offset: 0 })],
		'bridge',
		'cantilever',
	),
	build(
		'ramp',
		'Highway ramp',
		{ lanes: 1, laneWidth: 4.2, centerMarking: 'none', laneMarking: 'none', crosswalks: 'none', oneWay: true },
		(): SideSpec => [strip('shoulder', { width: 1.6 }), lining('guardrail', { placement: 'end', offset: 0.2 }), strip('verge', { width: 2.5, top: -0.05 })],
	),
	build(
		'service',
		'Service road',
		{ lanes: 2, laneWidth: 2.7, centerMarking: 'none', laneMarking: 'none', edgeLines: false, crosswalks: 'none' },
		(): SideSpec => [strip('curb'), strip('verge', { width: 1.2 })],
	),
	build(
		'pedestrian',
		'Pedestrian way',
		{ lanes: 1, laneWidth: 4.5, surface: 'sidewalk', centerMarking: 'none', laneMarking: 'none', edgeLines: false, crosswalks: 'none', crown: 0 },
		(): SideSpec => [strip('curb', { top: 0.05 }), lining('lamp', { spacing: 24 }), strip('verge', { width: 1.2 }), lining('tree', { spacing: 12 })],
	),
	build(
		'bike_path',
		'Bike path',
		{ lanes: 2, laneWidth: 1.4, surface: 'asphalt', centerMarking: 'dashed', laneMarking: 'none', edgeLines: false, crosswalks: 'none', crown: 0.02 },
		(): SideSpec => [strip('verge', { width: 1 })],
	),
	build('bridge_road', 'Bridge road', {}, (): SideSpec => [strip('curb'), strip('sidewalk', { width: 1.2 }), lining('guardrail', { placement: 'end', offset: 0.1 })], 'bridge'),
	build('tunnel_road', 'Tunnel road', { centerMarking: 'solid', crosswalks: 'none' }, (): SideSpec => [strip('curb'), strip('sidewalk', { width: 0.8 })], 'tunnel'),
	build(
		'race',
		'Race track',
		{ lanes: 2, laneWidth: 5, centerMarking: 'none', laneMarking: 'none', edgeLines: false, crosswalks: 'none' },
		(): SideSpec => [strip('racing_curb'), strip('shoulder', { width: 1.5, surface: 'terrain', top: -0.04 }), lining('guardrail', { placement: 'end', offset: 0.3 })],
	),
	build(
		'trail',
		'Trail',
		{ lanes: 1, laneWidth: 3, surface: 'trail', centerMarking: 'none', laneMarking: 'none', edgeLines: false, crosswalks: 'none', crown: 0.03 },
		(): SideSpec => [strip('verge', { width: 1.5, top: 0 }), lining('rock', { spacing: 10, density: 0.5 }), lining('tree', { spacing: 16, offset: 1, jitter: 0.5, density: 0.8 })],
	),
	build(
		'country',
		'Country road',
		{ laneWidth: 3, crosswalks: 'none', centerMarking: 'solid' },
		(): SideSpec => [strip('verge', { width: 2.2, top: -0.03 }), lining('tree', { spacing: 18, jitter: 0.5, density: 0.7, offset: 0.6 }), lining('rock', { spacing: 12, density: 0.25 })],
	),
];

const BY_ID: Map<string, RoadProfile> = new Map(BUILTIN_PROFILES.map((p: RoadProfile): [string, RoadProfile] => [p.id, p]));

export function builtinProfile(id: string): RoadProfile | undefined {
	return BY_ID.get(id);
}
