import type { Vec3 } from './types';

/** Logical surface a strip is made of. Resolved to an atlas tile by weather. */
export type SurfaceId =
	| 'asphalt'
	| 'trail'
	| 'sidewalk'
	| 'curb'
	| 'gutter'
	| 'terrain'
	| 'deck'
	| 'concrete'
	| 'racing_red'
	| 'racing_white';

export type StripType = 'gutter' | 'curb' | 'sidewalk' | 'shoulder' | 'verge' | 'bike_lane' | 'parking' | 'racing_curb';

export type LiningType =
	| 'lamp'
	| 'tree'
	| 'guardrail'
	| 'barrier'
	| 'bollard'
	| 'hedge'
	| 'fence'
	| 'wall'
	| 'rock'
	| 'marker';

/** Where a lining sits relative to the strip that precedes it in the side stack. */
export type Placement = 'start' | 'center' | 'end';

export type MarkingStyle = 'none' | 'solid' | 'dashed' | 'double';
export type Structure = 'auto' | 'ground' | 'bridge' | 'tunnel' | 'air';
/** How a bridge or viaduct is held up: square piers, a T-shaped cantilever, or a pair of piers per support. */
export type SupportStyle = 'pier' | 'cantilever' | 'twin';
/** Direction of travel on a one-way segment, relative to the order of its end nodes (a to b). */
export type Flow = 'forward' | 'reverse';
export type Weather = 'spring' | 'wet' | 'snow';
export type EndCap = 'flat' | 'round';
export type CrosswalkStyle = 'none' | 'zebra';

/** Procedural tree description shared by every tree lining. */
export interface TreeSpec {
	/** Name of a Procedural Trees preset, for example `oak_stylized`. */
	preset: string;
	/** Tree height in metres. */
	height: number;
	/** Number of distinct seeds blended along the road (1-8). */
	variants: number;
	/** Triangle budget per tree. */
	maxTriangles: number;
	seed: number;
}

export interface Carriageway {
	/** Total lanes across both directions. */
	lanes: number;
	laneWidth: number;
	/** Width of a raised divider between the two directions, 0 for none. */
	medianWidth: number;
	/** Centre line style between opposing lanes. */
	centerMarking: MarkingStyle;
	/** Dashed lines between lanes that travel the same way. */
	laneMarking: MarkingStyle;
	edgeLines: boolean;
	lineColor: 'white' | 'yellow';
	surface: SurfaceId;
	crown: number;
	crosswalks: CrosswalkStyle;
	/** Place a concrete barrier along a narrow median. */
	medianBarrier: boolean;
	/** All lanes travel the same way. Only recorded for engines; the segment's `flow` says which way. */
	oneWay?: boolean;
}

/** A paved or planted band beside the carriageway. Consumes lateral space. */
export interface StripElement {
	kind: 'strip';
	id: string;
	type: StripType;
	width: number;
	/** Height of the top surface relative to the carriageway edge, metres. */
	top: number;
	surface: SurfaceId;
}

/** A row of props or a continuous object placed at the current position in the side stack. */
export interface LiningElement {
	kind: 'lining';
	id: string;
	type: LiningType;
	enabled: boolean;
	placement: Placement;
	/** Extra lateral offset outward from the placement point, metres. */
	offset: number;
	/** Distance between props, metres. Ignored for continuous linings. */
	spacing: number;
	/** Random placement variation, 0-1 of the spacing. */
	jitter: number;
	scaleJitter: number;
	scale: number;
	/** Height of hedges, fences and walls, metres. */
	height: number;
	thickness: number;
	/** 0-1 chance that a slot receives a prop. */
	density: number;
	/** Metres to keep clear at both ends of each segment. */
	endMargin: number;
	/** Place one at every junction corner as well. */
	atJunctions: boolean;
	/** Alternate props to the opposite side of this lining's offset (staggered rows). */
	stagger: boolean;
	seed: number;
	tree: TreeSpec;
}

export type SideElement = StripElement | LiningElement;

export interface RoadProfile {
	id: string;
	name: string;
	carriageway: Carriageway;
	left: SideElement[];
	right: SideElement[];
	/** Structure used when a segment leaves its own structure on `auto`. */
	structure: Structure;
	/** Supports used where this road is a bridge. Defaults to piers. */
	support?: SupportStyle;
	builtin: boolean;
}

export type JunctionStyle = 'auto' | 'junction' | 'through';

export interface NodeOptions {
	style: JunctionStyle;
	/** Curb radius override in metres, negative to use the network default. */
	cornerRadius: number;
}

export interface SegmentData {
	profile: string;
	structure: Structure;
	/** When false the segment ends are straight and meet neighbours at a corner. */
	smooth: boolean;
	/** Explicit tangent handles relative to the end nodes, in model units. Null derives them. */
	handleA: Vec3 | null;
	handleB: Vec3 | null;
	/** Travel direction for one-way roads; both ways when left out. */
	flow?: Flow;
}

export interface JunctionSettings {
	cornerRadius: number;
	stopLines: boolean;
	endCap: EndCap;
	/** Segments of each rounded corner. */
	cornerSegments: number;
	/** Height difference above which crossing roads do not form a junction. */
	clearance: number;
}

export interface StructureSettings {
	pierSpacing: number;
	tunnelHeight: number;
	/** Height above ground at which `auto` turns into a bridge. */
	bridgeThreshold: number;
	/** Depth below ground at which `auto` turns into a tunnel. */
	tunnelThreshold: number;
	fanSpacing: number;
}

export interface BudgetSettings {
	maxTriangles: number;
	/** Thin low-priority instanced linings automatically until the road fits. */
	enforce: boolean;
}

export interface NetworkSettings {
	unitsPerMeter: number;
	groundY: number;
	defaultProfile: string;
	weather: Weather;
	/** Chord error allowed when sampling curves, metres. */
	curveError: number;
	seed: number;
	junction: JunctionSettings;
	structures: StructureSettings;
	budget: BudgetSettings;
}

export interface RoadNode {
	id: string;
	position: Vec3;
	options: NodeOptions;
}

export interface RoadSegment extends SegmentData {
	key: string;
	a: string;
	b: string;
}

/** The live road graph: nodes are native mesh vertices, segments are native mesh edges. */
export interface RoadNetwork {
	nodes: Map<string, RoadNode>;
	segments: Map<string, RoadSegment>;
	settings: NetworkSettings;
	/** Profiles edited or created inside this project. Built-in ids resolve from the library. */
	profiles: Map<string, RoadProfile>;
}

/** What is stored in the project next to the control mesh. */
export interface RoadDocument {
	version: 3;
	settings: NetworkSettings;
	profiles: Record<string, RoadProfile>;
	segments: Record<string, SegmentData>;
	nodes: Record<string, NodeOptions>;
}

export function edgeKey(a: string, b: string): string {
	return a < b ? `${a}|${b}` : `${b}|${a}`;
}
