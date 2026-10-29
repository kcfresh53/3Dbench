import type { RoadTerrain } from './terrain_context';
import type { MeshPart, Vec3 } from './types';
import type { CurveFrame, RoadCurve } from './curve';
import { offsetPoint } from './curve';
import type { NetworkSettings, RoadProfile, RoadSegment, Structure, SupportStyle } from './model';
import type { PartSet } from './part_set';
import type { GenerationContext } from './context';
import { propSource, ROAD_ATLAS } from './library_types';
import { emitPropInstance } from './instancing';
import type { InstanceFrame } from './instancing';
import { emitBand, emitRiser, fullUvs } from './surface';
import type { Ribbon } from './surface';
import type { ResolvedProfile } from './profile_resolve';
import { standingFrame } from './lining_emit';

export type ResolvedStructure = Exclude<Structure, 'auto'>;

const DOWN: Vec3 = [0, -1, 0];

/** Picks ground, bridge or tunnel for a segment: its own setting, then the profile's, then its height. */
export function resolveStructure(segment: RoadSegment, profile: RoadProfile, curve: RoadCurve, settings: NetworkSettings, terrain?: RoadTerrain): ResolvedStructure {
	if (segment.structure !== 'auto') return segment.structure;
	if (profile.structure !== 'auto') return profile.structure;
	if (terrain) return terrain.autoStructure(curve.polyline(Math.max(0.5, 2 * settings.unitsPerMeter)));
	const unit: number = settings.unitsPerMeter;
	const samples: Vec3[] = curve.polyline(Math.max(curve.length / 8, 1e-3));
	let total: number = 0;
	for (const p of samples) total += p[1];
	const mean: number = samples.length > 0 ? total / samples.length - settings.groundY : 0;
	if (mean > settings.structures.bridgeThreshold * unit) return 'bridge';
	if (mean < -settings.structures.tunnelThreshold * unit) return 'tunnel';
	return 'ground';
}

export interface StructureJob {
	set: PartSet;
	ctx: GenerationContext;
	settings: NetworkSettings;
	profile: ResolvedProfile;
	curve: RoadCurve;
	ribbon: Ribbon;
	from: number;
	to: number;
	structure: ResolvedStructure;
    segmentKey?: string;
}

export function emitStructure(job: StructureJob): void {
	if (job.structure === 'bridge') emitBridge(job);
	else if (job.structure === 'tunnel') emitTunnel(job);
}

function emitBridge(job: StructureJob): void {
	const { set, ctx, profile, ribbon, settings } = job;
	const unit: number = profile.unit;
	const tile: string = 'Bridge Deck';
	const column: string = 'Bridge Column';
	const thickness: number = 0.6 * unit;
	const left: number = -profile.extent.left;
	const right: number = profile.extent.right;
	emitBand(set, ctx.library, ribbon, { part: 'Bridge deck', tile, lat0: left, y0: -thickness, lat1: right, y1: -thickness }, DOWN);
	emitRiser(set, ctx.library, ribbon, 'Bridge deck', tile, left, -thickness, 0, -1);
	emitRiser(set, ctx.library, ribbon, 'Bridge deck', tile, right, -thickness, 0, 1);
	const support: SupportStyle = profile.profile.support ?? 'pier';
	// A cantilever carries the whole deck on one column, so it can stand further apart than plain piers.
	const spacing: number = Math.max(2, settings.structures.pierSpacing || 14) * unit * (support === 'cantilever' ? 1.5 : 1);
	const count: number = Math.max(1, Math.ceil((job.to - job.from) / spacing));
	const lanes: number[] = support === 'cantilever' ? [0] : support === 'twin' || right - left > 12 * unit ? [left * 0.5, right * 0.5] : [(left + right) / 2];
	for (let i: number = 0; i < count; i++) {
		const station: number = job.from + ((i + 0.5) * (job.to - job.from)) / count;
		for (const lateral of lanes) {
			// Search a bounded neighbourhood; omit a support when the road below needs the space.
			for (const shift of [0, -0.2, 0.2, -0.4, 0.4]) {
				const along: number = station + (shift * (job.to - job.from)) / count;
				const frame: CurveFrame = job.curve.frameAt(along);
				const centre: Vec3 = offsetPoint(frame, lateral, 0);
				const ground: number = ctx.terrain?.groundAt(centre[0], centre[2]) ?? settings.groundY;
				if (!Number.isFinite(ground) || frame.position[1] - thickness - ground < 0.5 * unit) continue;
				if (ctx.supports && !ctx.supports.allows(job.segmentKey ?? '', centre, ground, frame.position[1] - thickness, 0.6 * unit)) continue;
				if (support === 'cantilever') emitCantilever(set, ctx, frame, ground, thickness, unit, column, left, right);
				else emitPier(set, ctx, frame, lateral, ground, thickness, unit, column);
				break;
			}
		}
	}
}

/** Vertical box standing on the ground: `lat0`..`lat1` across the road, `depth` along it, from `y0` up to `y1` (world heights). */
function emitBox(set: PartSet, ctx: GenerationContext, frame: CurveFrame, lat0: number, lat1: number, depth: number, y0: number, y1: number, tile: string, bottom: boolean): void {
	const part: MeshPart = set.part('Bridge pier', ROAD_ATLAS);
	const at = (lateral: number, along: number, y: number): Vec3 => {
		const c: Vec3 = offsetPoint(frame, lateral, 0);
		return [c[0] + frame.forward[0] * along, y, c[2] + frame.forward[2] * along];
	};
	const ring: Array<[number, number]> = [[lat0, -depth], [lat1, -depth], [lat1, depth], [lat0, depth]];
	for (let i: number = 0; i < 4; i++) {
		const [l0, d0]: [number, number] = ring[i];
		const [l1, d1]: [number, number] = ring[(i + 1) % 4];
		// Facing is the outward direction of this side, built from the road's own axes.
		const sx: number = l0 === l1 ? Math.sign(l0 - (lat0 + lat1) / 2) : 0;
		const sz: number = d0 === d1 ? Math.sign(d0) : 0;
		const outward: Vec3 = [frame.right[0] * sx + frame.forward[0] * sz, 0, frame.right[2] * sx + frame.forward[2] * sz];
		set.polygon(part, [at(l0, d0, y0), at(l1, d1, y0), at(l1, d1, y1), at(l0, d0, y1)], fullUvs(ctx.library, tile), outward);
	}
	if (bottom) set.polygon(part, [at(lat0, -depth, y0), at(lat1, -depth, y0), at(lat1, depth, y0), at(lat0, depth, y0)], fullUvs(ctx.library, tile), DOWN);
}

/** A T-shaped support: one column under the centreline carrying a beam that reaches under both edges of the deck. */
function emitCantilever(set: PartSet, ctx: GenerationContext, frame: CurveFrame, groundY: number, thickness: number, unit: number, tile: string, left: number, right: number): void {
	const top: number = frame.position[1] - thickness;
	const beam: number = Math.min(1.4 * unit, Math.max(0.7 * unit, (top - groundY) * 0.18));
	const reach: number = 0.42;
	emitBox(set, ctx, frame, left * reach, right * reach, 0.5 * unit, top - beam, top, tile, true);
	emitBox(set, ctx, frame, -0.6 * unit, 0.6 * unit, 0.45 * unit, groundY, top - beam, tile, false);
}

function emitPier(set: PartSet, ctx: GenerationContext, frame: CurveFrame, lateral: number, groundY: number, thickness: number, unit: number, tile: string): void {
	const top: number = frame.position[1] - thickness;
	if (top - groundY < 0.5 * unit) return;
	emitBox(set, ctx, frame, lateral - 0.6 * unit, lateral + 0.6 * unit, 0.5 * unit, groundY, top, tile, false);
}

const LAMP_HEIGHT: number = 0.19;

function emitTunnel(job: StructureJob): void {
	const { set, ctx, profile, ribbon, settings } = job;
	const unit: number = profile.unit;
	const tile: string = 'Tunnel Wall';
	const ceiling: string = 'Tunnel Black Ceiling ';
	const height: number = settings.structures.tunnelHeight * unit;
	const wall: number = 0.3 * unit;
	const left: number = -(profile.extent.left + wall);
	const right: number = profile.extent.right + wall;
	emitRiser(set, ctx.library, ribbon, 'Tunnel', tile, left, 0, height, 1);
	emitRiser(set, ctx.library, ribbon, 'Tunnel', tile, right, 0, height, -1);
	emitBand(set, ctx.library, ribbon, { part: 'Tunnel ceiling', tile: ceiling, lat0: left, y0: height, lat1: right, y1: height }, DOWN);
	const lamp = propSource(ctx.library, 'Reshiba Lamp');
	const fan = propSource(ctx.library, 'Jet Fan');
	const length: number = job.to - job.from;
	const lampStep: number = 8 * unit;
	const lamps: number = Math.max(0, Math.round(length / lampStep));
	for (let i: number = 0; i < lamps; i++) {
		const frame: CurveFrame = job.curve.frameAt(job.from + ((i + 0.5) * length) / lamps);
		for (const lateral of [-profile.half * 0.55, profile.half * 0.55]) {
			emitPropInstance(set, 'Tunnel light', lamp, standingFrame(frame, 1, lateral, height - LAMP_HEIGHT * unit), 0, unit, unit, unit);
		}
	}
	const fans: number = Math.floor(length / (settings.structures.fanSpacing * unit));
	for (let i: number = 0; i < fans; i++) {
		const frame: CurveFrame = job.curve.frameAt(job.from + ((i + 0.5) * length) / fans);
		const stand: InstanceFrame = standingFrame(frame, 1, 0, height);
		emitPropInstance(set, 'Jet fan', fan, stand, 0, unit, unit, unit);
	}
}

/** Concrete barrier along a raised median. */
export function emitMedianBarrier(job: { set: PartSet; ctx: GenerationContext; profile: ResolvedProfile; curve: RoadCurve; from: number; to: number }): void {
	const { set, ctx, profile, curve } = job;
	if (!profile.carriageway.medianBarrier || profile.carriageway.medianWidth <= 0) return;
	const unit: number = profile.unit;
	const prop = propSource(ctx.library, 'Jersey Barrier Concrete Grey Middle');
	const step: number = 1.6 * unit;
	const length: number = job.to - job.from;
	const count: number = Math.max(1, Math.round(length / step));
	const stretch: number = length / count / step;
	for (let i: number = 0; i < count; i++) {
		const frame: CurveFrame = curve.frameAt(job.from + ((i + 0.5) * length) / count);
		emitPropInstance(set, 'Median barrier', prop, standingFrame(frame, 1, 0, 0.12 * unit), 0, unit, unit, unit * stretch);
	}
}
