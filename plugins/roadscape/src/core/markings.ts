import type { MeshPart, Vec2, Vec3 } from './types';
import type { RoadCurve, CurveFrame } from './curve';
import { offsetPoint } from './curve';
import type { MarkingStyle, NetworkSettings } from './model';
import type { PartSet } from './part_set';
import type { RoadLibrary } from './library_types';
import { ROAD_ATLAS } from './library_types';
import type { ResolvedProfile } from './profile_resolve';
import { UP, fullUvs } from './surface';

interface LineSpec {
	lateral: number;
	style: MarkingStyle;
}

const LINE_WIDTH: number = 0.12;
const DASH: number = 3;
const GAP: number = 5;

/** Which painted lines a carriageway has, and where. Lateral positions are model units. */
export function lineSpecs(profile: ResolvedProfile): LineSpec[] {
	const { carriageway, half, unit } = profile;
	const lw: number = carriageway.laneWidth * unit;
	const median: number = (carriageway.medianWidth * unit) / 2;
	const lanes: number = carriageway.lanes;
	const result: LineSpec[] = [];
	if (carriageway.edgeLines) {
		const inset: number = 0.22 * unit;
		result.push({ lateral: -(half - inset), style: 'solid' }, { lateral: half - inset, style: 'solid' });
		if (median > 0) result.push({ lateral: -(median + inset), style: 'solid' }, { lateral: median + inset, style: 'solid' });
	}
	if (lanes < 2) return result;
	if (median > 0) {
		const leftLanes: number = Math.floor(lanes / 2);
		const rightLanes: number = lanes - leftLanes;
		for (let k: number = 1; k < leftLanes; k++) result.push({ lateral: -half + k * lw, style: carriageway.laneMarking });
		for (let k: number = 1; k < rightLanes; k++) result.push({ lateral: median + k * lw, style: carriageway.laneMarking });
		return result;
	}
	const center: number = Math.floor(lanes / 2);
	for (let k: number = 1; k < lanes; k++) {
		result.push({ lateral: -half + k * lw, style: k === center ? carriageway.centerMarking : carriageway.laneMarking });
	}
	return result;
}

function surfaceHeight(profile: ResolvedProfile, lateral: number): number {
	if (profile.carriageway.medianWidth > 0) return 0;
	const crown: number = profile.carriageway.crown * profile.unit;
	return crown * (1 - Math.min(1, Math.abs(lateral) / profile.half));
}

/** Paints one line between two arc-length distances, splitting it only where the road bends. */
function paintLine(set: PartSet, library: RoadLibrary, curve: RoadCurve, profile: ResolvedProfile, settings: NetworkSettings, tile: string, lateral: number, from: number, to: number): void {
	const unit: number = profile.unit;
	const part: MeshPart = set.part('Lane marking', ROAD_ATLAS);
	const width: number = LINE_WIDTH * unit;
	const lift: number = 0.018 * unit;
	const stops: number[] = curve.stops(from, to, 1e6, settings.curveError * unit);
	const uvs: Vec2[] = fullUvs(library, tile);
	for (let i: number = 0; i < stops.length - 1; i++) {
		const f0: CurveFrame = curve.frameAt(stops[i]);
		const f1: CurveFrame = curve.frameAt(stops[i + 1]);
		const y: number = surfaceHeight(profile, lateral) + lift;
		const corners: Vec3[] = [
			offsetPoint(f0, lateral - width / 2, y),
			offsetPoint(f0, lateral + width / 2, y),
			offsetPoint(f1, lateral + width / 2, y),
			offsetPoint(f1, lateral - width / 2, y),
		];
		set.polygon(part, corners, uvs, UP);
	}
}

/** Lane lines, centre lines and edge lines for one stretch of road. */
export function emitMarkings(set: PartSet, library: RoadLibrary, curve: RoadCurve, from: number, to: number, profile: ResolvedProfile, settings: NetworkSettings): void {
	const unit: number = profile.unit;
	const tile: string = profile.carriageway.lineColor === 'yellow' ? 'Marking Yellow' : 'Marking';
	const dash: number = DASH * unit;
	const gap: number = GAP * unit;
	for (const line of lineSpecs(profile)) {
		if (line.style === 'none') continue;
		const laterals: number[] = line.style === 'double' ? [line.lateral - 0.13 * unit, line.lateral + 0.13 * unit] : [line.lateral];
		for (const lateral of laterals) {
			if (line.style !== 'dashed') {
				paintLine(set, library, curve, profile, settings, tile, lateral, from + 0.2 * unit, to - 0.2 * unit);
				continue;
			}
			for (let start: number = from + gap / 2; start < to - 0.8 * unit; start += dash + gap) {
				const end: number = Math.min(to - 0.2 * unit, start + dash);
				if (end - start > 0.8 * unit) paintLine(set, library, curve, profile, settings, tile, lateral, start, end);
			}
		}
	}
}
