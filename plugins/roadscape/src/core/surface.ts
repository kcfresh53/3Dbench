import type { MeshPart, Vec2, Vec3 } from './types';
import type { CurveFrame, RoadCurve } from './curve';
import { offsetPoint } from './curve';
import type { PartSet } from './part_set';
import type { RoadLibrary } from './library_types';
import { ROAD_ATLAS, tileUv } from './library_types';
import type { ResolvedProfile, ResolvedSide, ResolvedStrip } from './profile_resolve';
import { surfaceTile, tileSizeMeters } from './strip_library';
import type { MarkingStyle, NetworkSettings } from './model';

export const UP: Vec3 = [0, 1, 0];

/** Cross-sections along a stretch of road: one frame per stop. */
export interface Ribbon {
	frames: CurveFrame[];
	distances: number[];
	unit: number;
}

export function makeRibbon(curve: RoadCurve, from: number, to: number, unit: number, settings: NetworkSettings, maxSpanMeters: number = 10): Ribbon {
	const distances: number[] = curve.stops(from, to, maxSpanMeters * unit, settings.curveError * unit);
	return { frames: distances.map((d: number): CurveFrame => curve.frameAt(d)), distances, unit };
}

/** Same sampling, but only where the curve actually bends. Used for features that do not tile. */
export function makeBendRibbon(curve: RoadCurve, from: number, to: number, unit: number, settings: NetworkSettings): Ribbon {
	return makeRibbon(curve, from, to, unit, settings, 1e6);
}

function fract(x: number): number {
	return x - Math.floor(x);
}

/** UVs for a quad whose corners run (lat0,d0) (lat1,d0) (lat1,d1) (lat0,d1), tiled at a fixed texel density. */
export function tiledUvs(library: RoadLibrary, tile: string, tileLength: number, across: number, d0: number, d1: number): Vec2[] {
	const su: number = Math.min(1, across / tileLength);
	const sv: number = Math.min(1, (d1 - d0) / tileLength);
	const v0: number = Math.min(fract(d0 / tileLength), 1 - sv);
	return [tileUv(library, tile, 0, v0), tileUv(library, tile, su, v0), tileUv(library, tile, su, v0 + sv), tileUv(library, tile, 0, v0 + sv)];
}

export function fullUvs(library: RoadLibrary, tile: string): Vec2[] {
	return [tileUv(library, tile, 0, 0), tileUv(library, tile, 1, 0), tileUv(library, tile, 1, 1), tileUv(library, tile, 0, 1)];
}

export interface BandSpec {
	part: string;
	tile: string;
	lat0: number;
	y0: number;
	lat1: number;
	y1: number;
}

/** Sweeps one upward-facing surface band (a line in the cross-section) along the ribbon. */
export function emitBand(set: PartSet, library: RoadLibrary, ribbon: Ribbon, band: BandSpec, facing: Vec3 = UP): void {
	const part: MeshPart = set.part(band.part, ROAD_ATLAS);
	const tileLength: number = tileSizeMeters(band.tile) * ribbon.unit;
	const across: number = Math.hypot(band.lat1 - band.lat0, band.y1 - band.y0);
	for (let i: number = 0; i < ribbon.frames.length - 1; i++) {
		const f0: CurveFrame = ribbon.frames[i];
		const f1: CurveFrame = ribbon.frames[i + 1];
		set.polygon(
			part,
			[offsetPoint(f0, band.lat0, band.y0), offsetPoint(f0, band.lat1, band.y1), offsetPoint(f1, band.lat1, band.y1), offsetPoint(f1, band.lat0, band.y0)],
			tiledUvs(library, band.tile, tileLength, across, ribbon.distances[i], ribbon.distances[i + 1]),
			facing,
		);
	}
}

const PART_NAMES: Record<string, string> = {
	gutter: 'Gutter',
	curb: 'Curb',
	sidewalk: 'Sidewalk',
	shoulder: 'Road shoulder',
	verge: 'Verge',
	bike_lane: 'Bike lane',
	parking: 'Parking lane',
	racing_curb: 'Racing curb',
};

export function stripPartName(type: string): string {
	return PART_NAMES[type] ?? 'Road side';
}

/** Emits the paved carriageway, including a crown or a raised median. */
export function emitCarriageway(set: PartSet, library: RoadLibrary, ribbon: Ribbon, profile: ResolvedProfile, settings: NetworkSettings): void {
	const { carriageway, half, unit } = profile;
	const tile: string = surfaceTile(carriageway.surface, settings.weather);
	const median: number = carriageway.medianWidth * unit;
	if (median > 0) {
		const m: number = median / 2;
		const grass: boolean = carriageway.medianWidth > 1.5;
		const top: number = 0.12 * unit;
		const medianTile: string = grass ? surfaceTile('terrain', settings.weather) : surfaceTile('concrete', settings.weather);
		emitBand(set, library, ribbon, { part: 'Road surface', tile, lat0: -half, y0: 0, lat1: -m, y1: 0 });
		emitBand(set, library, ribbon, { part: 'Road surface', tile, lat0: m, y0: 0, lat1: half, y1: 0 });
		emitBand(set, library, ribbon, { part: 'Median', tile: medianTile, lat0: -m, y0: top, lat1: m, y1: top });
		const curb: string = surfaceTile('curb', settings.weather);
		emitRiser(set, library, ribbon, 'Median', curb, -m, 0, top, -1);
		emitRiser(set, library, ribbon, 'Median', curb, m, 0, top, 1);
		return;
	}
	const crown: number = carriageway.crown * unit;
	if (crown < 0.004 * unit) {
		emitBand(set, library, ribbon, { part: 'Road surface', tile, lat0: -half, y0: 0, lat1: half, y1: 0 });
		return;
	}
	emitBand(set, library, ribbon, { part: 'Road surface', tile, lat0: -half, y0: 0, lat1: 0, y1: crown });
	emitBand(set, library, ribbon, { part: 'Road surface', tile, lat0: 0, y0: crown, lat1: half, y1: 0 });
}

/** Emits every strip of one side, plus the risers where neighbouring strips differ in height. */
export function emitSide(set: PartSet, library: RoadLibrary, ribbon: Ribbon, side: ResolvedSide): void {
	const sign: number = side.sign;
	for (const strip of side.strips) {
		emitStrip(set, library, ribbon, strip, sign);
	}
}

function emitStrip(set: PartSet, library: RoadLibrary, ribbon: Ribbon, strip: ResolvedStrip, sign: number): void {
	const name: string = stripPartName(strip.element.type);
	const lat0: number = strip.inner * sign;
	const lat1: number = strip.outer * sign;
	if (strip.outer - strip.inner > 1e-6) {
		if (strip.element.type === 'racing_curb') emitRacingCurb(set, library, ribbon, strip, sign);
		else emitBand(set, library, ribbon, { part: name, tile: strip.tile, lat0, y0: strip.top, lat1, y1: strip.top });
	}
	const rise: number = strip.top - strip.prevTop;
	if (Math.abs(rise) > 1e-4) {
		// The riser belongs to the taller of the two neighbours and faces the lower one.
		const faceSign: number = rise > 0 ? -sign : sign;
		const low: number = Math.min(strip.top, strip.prevTop);
		const high: number = Math.max(strip.top, strip.prevTop);
		emitRiser(set, library, ribbon, name, strip.tile, lat0, low, high, faceSign);
	}
}

/** A vertical face along the road. `faceSign` +1 faces the right-hand side of travel, -1 the left. */
export function emitRiser(set: PartSet, library: RoadLibrary, ribbon: Ribbon, name: string, tile: string, lateral: number, low: number, high: number, faceSign: number): void {
	const part: MeshPart = set.part(name, ROAD_ATLAS);
	const tileLength: number = tileSizeMeters(tile) * ribbon.unit;
	for (let i: number = 0; i < ribbon.frames.length - 1; i++) {
		const f0: CurveFrame = ribbon.frames[i];
		const f1: CurveFrame = ribbon.frames[i + 1];
		const facing: Vec3 = [f0.right[0] * faceSign, 0, f0.right[2] * faceSign];
		set.polygon(
			part,
			[offsetPoint(f0, lateral, low), offsetPoint(f0, lateral, high), offsetPoint(f1, lateral, high), offsetPoint(f1, lateral, low)],
			tiledUvs(library, tile, tileLength, high - low, ribbon.distances[i], ribbon.distances[i + 1]),
			facing,
		);
	}
}

function emitRacingCurb(set: PartSet, library: RoadLibrary, ribbon: Ribbon, strip: ResolvedStrip, sign: number): void {
	const red: string = surfaceTile('racing_red', 'spring');
	const white: string = surfaceTile('racing_white', 'spring');
	const part: MeshPart = set.part('Racing curb', ROAD_ATLAS);
	const block: number = 2 * ribbon.unit;
	for (let i: number = 0; i < ribbon.frames.length - 1; i++) {
		const tile: string = Math.floor(ribbon.distances[i] / block) % 2 === 0 ? red : white;
		const f0: CurveFrame = ribbon.frames[i];
		const f1: CurveFrame = ribbon.frames[i + 1];
		set.polygon(
			part,
			[offsetPoint(f0, strip.inner * sign, strip.top), offsetPoint(f0, strip.outer * sign, strip.top), offsetPoint(f1, strip.outer * sign, strip.top), offsetPoint(f1, strip.inner * sign, strip.top)],
			fullUvs(library, tile),
			UP,
		);
	}
}

export type { MarkingStyle };
