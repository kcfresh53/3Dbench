import type { Flow, RoadNetwork, RoadNode, RoadSegment } from '../../../../roadscape/src/core/model';
import { addNode, addSegment, buildIndex, segmentCurve } from '../../../../roadscape/src/core/network';
import type { NetworkIndex } from '../../../../roadscape/src/core/network';
import { splitSegmentAt } from '../../../../roadscape/src/core/network_edit';
import type { IdFactory } from '../../../../roadscape/src/core/network_edit';
import type { CurveFrame, RoadCurve } from '../../../../roadscape/src/core/curve';
import type { Vec3 } from '../types';

/** Which way the highway's traffic runs along the segment: from its first node to its second, or back. */
export type TravelDirection = 'forward' | 'backward';

export interface RampOptions {
	/** Side of the highway the ramp sits on, seen by a driver travelling in `travel`. */
	side: 'left' | 'right';
	/** `exit` lets traffic leave the highway, `entry` lets it join. */
	kind: 'exit' | 'entry';
	/** The direction of travel on the highway this ramp serves. */
	travel: TravelDirection;
	/** Distance from the highway to the far end of the ramp, in model units. */
	length: number;
	/** How far the ramp has swung away from the highway at its far end, radians. */
	turn: number;
	/** Profile of the ramp. */
	profile: string;
	/** Height the far end sits above (positive) or below the highway, in model units. */
	rise: number;
}

export const DEFAULT_RAMP: Omit<RampOptions, 'length'> = { side: 'right', kind: 'exit', travel: 'forward', turn: (35 * Math.PI) / 180, profile: 'ramp', rise: 0 };

export interface RampResult {
	/** The point on the highway where the ramp leaves or joins. */
	junction: string;
	/** The far end of the ramp. */
	end: string;
	/** Key of the ramp segment. */
	segment: string;
	/** Keys of the two highway pieces either side of the junction. */
	highway: [string, string];
}

/** Distance from either end of a highway piece that a ramp must keep, in model units. */
const MIN_MARGIN: number = 4;

function unit2(x: number, z: number): [number, number] {
	const l: number = Math.hypot(x, z);
	return l < 1e-9 ? [1, 0] : [x / l, z / l];
}

/**
 * Adds a ramp to a highway segment. The highway is split at `along` metres (model units) from the first
 * node of the segment, and a ramp of ordinary Roadscape geometry leaves from the new point. The ramp starts
 * tangent to the highway, so exits peel away and entries merge at a shallow angle, then swings out by `turn`.
 * One-way direction is recorded on the ramp so engines know which way traffic runs.
 */
export function makeRamp(network: RoadNetwork, segmentKey: string, along: number, options: RampOptions, ids: IdFactory): RampResult {
	const segment: RoadSegment | undefined = network.segments.get(segmentKey);
	if (!segment) throw new Error('That road no longer exists.');
	const index: NetworkIndex = buildIndex(network);
	const curve: RoadCurve = segmentCurve(network, index, segment);
	if (curve.length < MIN_MARGIN * 2 || along < MIN_MARGIN || along > curve.length - MIN_MARGIN) throw new Error('Pick a point at least a few metres from either end of the road.');
	const frame: CurveFrame = curve.frameAt(along);
	const sign: 1 | -1 = options.travel === 'forward' ? 1 : -1;
	// Basis in the ground plane: where highway traffic is heading here, and which way is its right.
	const [dx, dz]: [number, number] = unit2(frame.forward[0] * sign, frame.forward[2] * sign);
	const [rx, rz]: [number, number] = unit2(frame.right[0] * sign, frame.right[2] * sign);
	const side: number = options.side === 'right' ? 1 : -1;
	const ahead: number = options.kind === 'exit' ? 1 : -1;
	const ex: number = dx * ahead;
	const ez: number = dz * ahead;
	const lx: number = rx * side;
	const lz: number = rz * side;
	const swing = (angle: number): [number, number] => [ex * Math.cos(angle) + lx * Math.sin(angle), ez * Math.cos(angle) + lz * Math.sin(angle)];
	const chord: [number, number] = swing(options.turn / 2);
	const finish: [number, number] = swing(options.turn);

	const split = splitSegmentAt(network, segmentKey, along, ids());
	const junction: RoadNode = split.node;
	const endId: string = ids();
	const reach: number = options.length;
	const end: RoadNode = addNode(network, endId, [junction.position[0] + chord[0] * reach, junction.position[1] + options.rise, junction.position[2] + chord[1] * reach]);
	const k: number = reach / 3;
	// Tangent at the far end points the way the ramp is heading; the handle there points back along it.
	const handleStart: Vec3 = [ex * k, 0, ez * k];
	const handleEnd: Vec3 = [-finish[0] * k, 0, -finish[1] * k];
	const ramp: RoadSegment = addSegment(network, junction.id, end.id, { profile: options.profile, structure: 'auto', smooth: true, handleA: handleStart, handleB: handleEnd });
	const from: string = options.kind === 'exit' ? junction.id : end.id;
	const flow: Flow = ramp.a === from ? 'forward' : 'reverse';
	ramp.flow = flow;
	return { junction: junction.id, end: end.id, segment: ramp.key, highway: [split.first.key, split.second.key] };
}
