import type { Carriageway, LiningElement, RoadProfile, SideElement, StripElement, Weather } from './model';
import { surfaceTile } from './strip_library';

/** A strip with absolute lateral extents, in model units, measured outward from the centreline. */
export interface ResolvedStrip {
	element: StripElement;
	tile: string;
	inner: number;
	outer: number;
	/** Height of the top surface above the road surface at the carriageway edge. */
	top: number;
	/** Height of whatever lies inward of this strip. */
	prevTop: number;
	layer: number;
}

export interface ResolvedLining {
	element: LiningElement;
	/** Lateral distance from the centreline to the lining, outward positive. */
	lateral: number;
	baseY: number;
	/** Index of the strip the lining sits on, or -1 when it stands on the carriageway edge. */
	layer: number;
	/** Distance from the centreline to the outer edge of everything that precedes it. */
	cursor: number;
}

export interface ResolvedSide {
	/** -1 for the left of the direction of travel, +1 for the right. */
	sign: -1 | 1;
	strips: ResolvedStrip[];
	linings: ResolvedLining[];
	/** Offsets of every layer boundary: edge[0] is the carriageway edge, edge[k+1] the outer edge of strip k. */
	edges: number[];
	/** Surface heights matching `edges`: tops[0] is the carriageway edge. */
	tops: number[];
	outer: number;
}

export interface ResolvedProfile {
	profile: RoadProfile;
	carriageway: Carriageway;
	/** Metres to model units. */
	unit: number;
	/** Half the carriageway width including any median. */
	half: number;
	left: ResolvedSide;
	right: ResolvedSide;
	/** Lateral extents of the whole cross-section. */
	extent: { left: number; right: number };
}

function resolveSide(elements: SideElement[], sign: -1 | 1, half: number, unit: number, weather: Weather): ResolvedSide {
	const strips: ResolvedStrip[] = [];
	const linings: ResolvedLining[] = [];
	const edges: number[] = [half];
	const tops: number[] = [0];
	let cursor: number = half;
	let prevTop: number = 0;
	for (const element of elements) {
		if (element.kind === 'strip') {
			const width: number = Math.max(0, element.width) * unit;
			const top: number = element.top * unit;
			strips.push({ element, tile: surfaceTile(element.surface, weather), inner: cursor, outer: cursor + width, top, prevTop, layer: strips.length });
			cursor += width;
			prevTop = top;
			edges.push(cursor);
			tops.push(top);
		} else if (element.enabled) {
			const last: ResolvedStrip | undefined = strips[strips.length - 1];
			let base: number = cursor;
			if (last) base = element.placement === 'start' ? last.inner : element.placement === 'center' ? (last.inner + last.outer) / 2 : last.outer;
			linings.push({ element, lateral: base + element.offset * unit, baseY: last ? last.top : 0, layer: last ? last.layer : -1, cursor });
		}
	}
	return { sign, strips, linings, edges, tops, outer: cursor };
}

export function carriagewayHalf(carriageway: Carriageway, unit: number): number {
	return ((carriageway.lanes * carriageway.laneWidth + carriageway.medianWidth) * unit) / 2;
}

export function resolveProfile(profile: RoadProfile, unit: number, weather: Weather): ResolvedProfile {
	const half: number = carriagewayHalf(profile.carriageway, unit);
	const left: ResolvedSide = resolveSide(profile.left, -1, half, unit, weather);
	const right: ResolvedSide = resolveSide(profile.right, 1, half, unit, weather);
	return { profile, carriageway: profile.carriageway, unit, half, left, right, extent: { left: left.outer, right: right.outer } };
}
