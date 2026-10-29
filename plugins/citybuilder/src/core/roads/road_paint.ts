import type { RoadNetwork, RoadSegment, Structure } from '../../../../roadscape/src/core/model';
import { buildIndex, segmentCurve } from '../../../../roadscape/src/core/network';
import { splitSegmentAt } from '../../../../roadscape/src/core/network_edit';
import type { IdFactory } from '../../../../roadscape/src/core/network_edit';
import type { RoadCurve } from '../../../../roadscape/src/core/curve';
import type { Vec3 } from '../types';

/** True where a ground position (city metres) is inside the painted area. */
export type RegionTest = (x: number, z: number) => boolean;

/** What to change on the painted stretches. Fields left out stay as they are. */
export interface RoadChange {
	profile?: string;
	structure?: Structure;
}

export interface RoadPaintOptions {
	/** Converts a point in network space to city metres. */
	toCity: (p: Vec3) => Vec3;
	/** Metres per network length unit. */
	metresPerUnit: number;
	/** Painted stretches shorter than this are dropped and shorter gaps are bridged, metres. */
	minPiece: number;
	/** Spacing of the test points along each road, metres. */
	sample: number;
}

export const DEFAULT_ROAD_PAINT: Pick<RoadPaintOptions, 'minPiece' | 'sample'> = { minPiece: 4, sample: 1.5 };

export interface RoadPaintResult {
	/** Road pieces whose type was changed. */
	changed: number;
	/** Roads that had to be cut to do it. */
	split: number;
}

interface Span {
	from: number;
	to: number;
}

function differs(segment: RoadSegment, change: RoadChange): boolean {
	return (change.profile !== undefined && segment.profile !== change.profile) || (change.structure !== undefined && segment.structure !== change.structure);
}

function apply(segment: RoadSegment, change: RoadChange): void {
	if (change.profile !== undefined) segment.profile = change.profile;
	if (change.structure !== undefined) segment.structure = change.structure;
}

/** Arc-length spans of a curve that lie inside the region, with edges refined by bisection. */
function spansInside(curve: RoadCurve, region: RegionTest, options: RoadPaintOptions): Span[] {
	const length: number = curve.length;
	const metres: number = length * options.metresPerUnit;
	const steps: number = Math.max(2, Math.ceil(metres / options.sample));
	const inside = (s: number): boolean => {
		const p: Vec3 = options.toCity(curve.pointAt(curve.tAtDistance(s)));
		return region(p[0], p[2]);
	};
	const flags: boolean[] = [];
	for (let i: number = 0; i <= steps; i++) flags.push(inside((length * i) / steps));
	const refine = (outside: number, within: number): number => {
		let lo: number = outside;
		let hi: number = within;
		for (let i: number = 0; i < 10; i++) {
			const mid: number = (lo + hi) / 2;
			if (inside(mid)) hi = mid;
			else lo = mid;
		}
		return hi;
	};
	const spans: Span[] = [];
	let start: number | null = null;
	for (let i: number = 0; i <= steps; i++) {
		const s: number = (length * i) / steps;
		if (flags[i] && start === null) start = i === 0 ? 0 : refine((length * (i - 1)) / steps, s);
		if (start !== null && (!flags[i] || i === steps)) {
			const end: number = flags[i] ? length : refineEnd((length * (i - 1)) / steps, s, inside);
			spans.push({ from: start, to: end });
			start = null;
		}
	}
	return spans;
}

function refineEnd(within: number, outside: number, inside: (s: number) => boolean): number {
	let lo: number = within;
	let hi: number = outside;
	for (let i: number = 0; i < 10; i++) {
		const mid: number = (lo + hi) / 2;
		if (inside(mid)) lo = mid;
		else hi = mid;
	}
	return lo;
}

/** Joins spans separated by less than `gap`, drops spans shorter than `minimum`, snaps near-end spans to the ends. */
function tidy(spans: Span[], length: number, minimum: number, gap: number): Span[] {
	const merged: Span[] = [];
	for (const span of spans) {
		const last: Span | undefined = merged[merged.length - 1];
		if (last && span.from - last.to < gap) last.to = span.to;
		else merged.push({ ...span });
	}
	const result: Span[] = [];
	for (const span of merged) {
		const from: number = span.from < minimum ? 0 : span.from;
		const to: number = length - span.to < minimum ? length : span.to;
		if (to - from >= minimum || (from === 0 && to === length)) result.push({ from, to });
	}
	return result;
}

/**
 * Changes the road type of every stretch of road inside a region. Roads are cut at the region's edge so the
 * rest keeps its type; the cut points are ordinary road points that can be moved afterwards. Painting a
 * type a stretch already has does nothing, so repeated strokes never pile up tiny pieces.
 */
export function paintRoadType(network: RoadNetwork, region: RegionTest, change: RoadChange, ids: IdFactory, options: RoadPaintOptions): RoadPaintResult {
	const result: RoadPaintResult = { changed: 0, split: 0 };
	const minimum: number = options.minPiece / options.metresPerUnit;
	for (const key of [...network.segments.keys()]) {
		const segment: RoadSegment | undefined = network.segments.get(key);
		if (!segment) continue;
		const curve: RoadCurve = segmentCurve(network, buildIndex(network), segment);
		const spans: Span[] = tidy(spansInside(curve, region, options), curve.length, minimum, minimum);
		if (spans.length === 0) continue;
		if (spans.length === 1 && spans[0].from === 0 && spans[0].to === curve.length) {
			if (differs(segment, change)) {
				apply(segment, change);
				result.changed++;
			}
			continue;
		}
		// Work from the far end so earlier cut distances stay valid on the remaining head piece.
		let head: RoadSegment = segment;
		let headLength: number = curve.length;
		for (let i: number = spans.length - 1; i >= 0; i--) {
			const span: Span = spans[i];
			if (!differs(head, change)) break;
			let piece: RoadSegment = head;
			if (span.to < headLength - 1e-6) {
				const cut = splitSegmentAt(network, head.key, span.to, ids());
				head = cut.first;
				piece = cut.first;
				result.split++;
			}
			if (span.from > 1e-6) {
				const cut = splitSegmentAt(network, piece.key, span.from, ids());
				head = cut.first;
				piece = cut.second;
				result.split++;
			}
			apply(piece, change);
			result.changed++;
			headLength = span.from;
			if (span.from <= 1e-6) break;
		}
	}
	return result;
}
