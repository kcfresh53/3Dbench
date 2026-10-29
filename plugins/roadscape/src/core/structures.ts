import type { RoadTerrain } from './terrain_context';
import type { MeshPart, Vec3 } from './types';
import type { CurveFrame, RoadCurve } from './curve';
import { offsetPoint } from './curve';
import type { NetworkSettings, RoadProfile, RoadSegment, Structure } from './model';
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
	const spacing: number = settings.structures.pierSpacing * unit;
	const count: number = Math.max(1, Math.round((job.to - job.from) / spacing));
	const lanes: number[] = right - left > 12 * unit ? [left * 0.5, right * 0.5] : [(left + right) / 2];
	for (let i: number = 0; i < count; i++) {
		const frame: CurveFrame = job.curve.frameAt(job.from + ((i + 0.5) * (job.to - job.from)) / count);
		for (const lateral of lanes) {
			const centre=offsetPoint(frame,lateral,0);
			const ground=ctx.terrain?.groundAt(centre[0],centre[2]) ?? settings.groundY;
			if(Number.isFinite(ground))emitPier(set,ctx,frame,lateral,ground,thickness,unit,column);
		}
	}
}

function emitPier(set: PartSet, ctx: GenerationContext, frame: CurveFrame, lateral: number, groundY: number, thickness: number, unit: number, tile: string): void {
	const top: number = frame.position[1] - thickness;
	if (top - groundY < 0.5 * unit) return;
	const part: MeshPart = set.part('Bridge pier', ROAD_ATLAS);
	const w: number = 0.6 * unit;
	const d: number = 0.5 * unit;
	const centre: Vec3 = offsetPoint(frame, lateral, 0);
	const corner = (a: number, b: number, y: number): Vec3 => [
		centre[0] + frame.right[0] * w * a + frame.forward[0] * d * b,
		y,
		centre[2] + frame.right[2] * w * a + frame.forward[2] * d * b,
	];
	const around: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
	for (let i: number = 0; i < 4; i++) {
		const [a0, b0]: [number, number] = around[i];
		const [a1, b1]: [number, number] = around[(i + 1) % 4];
		const mid: Vec3 = [centre[0] + frame.right[0] * w * (a0 + a1) * 0.5 + frame.forward[0] * d * (b0 + b1) * 0.5 - centre[0], 0, centre[2] + frame.right[2] * w * (a0 + a1) * 0.5 + frame.forward[2] * d * (b0 + b1) * 0.5 - centre[2]];
		set.polygon(part, [corner(a0, b0, groundY), corner(a1, b1, groundY), corner(a1, b1, top), corner(a0, b0, top)], fullUvs(ctx.library, tile), mid);
	}
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
