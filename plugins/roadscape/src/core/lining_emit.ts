import type { MeshPart, Vec2, Vec3 } from './types';
import type { RoadCurve, CurveFrame } from './curve';
import { offsetPoint } from './curve';
import type { LiningElement, NetworkSettings, Structure } from './model';
import type { PartSet } from './part_set';
import { propSource, ROAD_ATLAS } from './library_types';
import type { PropSource } from './library_types';
import type { BuildReport, DensityMap, GenerationContext, TreeAsset } from './context';
import { LINING_TYPES } from './lining_library';
import type { LiningDefinition } from './lining_library';
import { emitPropInstance } from './instancing';
import type { InstanceFrame, SlotPlan } from './instancing';
import { planSlots } from './instancing';
import type { ResolvedLining, ResolvedProfile, ResolvedSide } from './profile_resolve';
import { emitBand, emitRiser, fullUvs, makeBendRibbon, makeRibbon } from './surface';
import type { Ribbon } from './surface';
import { surfaceTile } from './strip_library';

export interface LiningJob {
	set: PartSet;
	ctx: GenerationContext;
	report: BuildReport;
	settings: NetworkSettings;
	profile: ResolvedProfile;
	curve: RoadCurve;
	from: number;
	to: number;
	segmentKey: string;
	structure: Exclude<Structure, 'auto'>;
	density: DensityMap;
}

export function liningVisible(def: LiningDefinition, structure: Exclude<Structure, 'auto'>): boolean {
	return def.structures.includes(structure);
}

/** Builds every enabled lining on both sides of a stretch of road. */
export function emitLinings(job: LiningJob): void {
	for (const side of [job.profile.left, job.profile.right]) {
		for (const lining of side.linings) {
			const def: LiningDefinition = LINING_TYPES[lining.element.type];
			if (!liningVisible(def, job.structure)) continue;
			const before: number = job.set.triangles;
			emitLining(job, side, lining, def);
			const id: string = lining.element.id;
			job.report.liningTriangles.set(id, (job.report.liningTriangles.get(id) ?? 0) + job.set.triangles - before);
		}
	}
}

function emitLining(job: LiningJob, side: ResolvedSide, lining: ResolvedLining, def: LiningDefinition): void {
	switch (lining.element.type) {
		case 'guardrail':
			emitGuardrail(job, side, lining);
			return;
		case 'hedge':
			emitSolidBox(job, side, lining, 'Hedge', surfaceTile('terrain', job.settings.weather));
			return;
		case 'wall':
			emitSolidBox(job, side, lining, 'Wall', surfaceTile('concrete', job.settings.weather));
			return;
		case 'fence':
			emitFence(job, side, lining);
			return;
		case 'tree':
			emitTrees(job, side, lining);
			return;
		default:
			emitProps(job, side, lining, def);
	}
}

function frameFor(curveFrame: CurveFrame, side: ResolvedSide, lateral: number, height: number): InstanceFrame {
	// Props use a rotation, never a mirror: on the left the local +Z axis runs against travel.
	const inward: Vec3 = side.sign > 0 ? [-curveFrame.right[0], 0, -curveFrame.right[2]] : [curveFrame.right[0], 0, curveFrame.right[2]];
	const forward: Vec3 = side.sign > 0 ? curveFrame.forward : [-curveFrame.forward[0], 0, -curveFrame.forward[2]];
	return { position: offsetPoint(curveFrame, lateral * side.sign, height), forward, inward };
}

/** Creates the frame a prop stands in, for use by junction code as well. */
export function standingFrame(frame: CurveFrame, sign: -1 | 1, lateral: number, height: number): InstanceFrame {
	return frameFor(frame, { sign } as ResolvedSide, lateral, height);
}

function partLabel(def: LiningDefinition): string {
	return def.label;
}

function emitProps(job: LiningJob, side: ResolvedSide, lining: ResolvedLining, def: LiningDefinition): void {
	const element: LiningElement = lining.element;
	const unit: number = job.profile.unit;
	const source: PropSource = propSource(job.ctx.library, def.prop);
	const keep: number = job.density.get(element.id) ?? 1;
	const plan: SlotPlan = planSlots(element, unit, job.segmentKey, side.sign, job.from, job.to, keep, def.fitLength, def.randomYaw);
	for (const slot of plan.slots) {
		const curveFrame: CurveFrame = job.curve.frameAt(slot.distance);
		const lateral: number = lining.lateral + slot.lateral * element.jitter * Math.max(plan.step * 0.25, 0.3 * unit);
		const size: number = element.scale * unit * (1 + slot.scale * element.scaleJitter);
		const stretch: number = def.fitLength > 0 ? plan.step / (def.fitLength * unit * element.scale) : 1;
		emitPropInstance(job.set, partLabel(def), source, frameFor(curveFrame, side, lateral, lining.baseY), slot.yaw, size, size, size * stretch);
	}
}

function emitTrees(job: LiningJob, side: ResolvedSide, lining: ResolvedLining): void {
	const element: LiningElement = lining.element;
	const unit: number = job.profile.unit;
	const assets: TreeAsset[] = job.ctx.trees.assets(element.tree, unit);
	if (assets.length === 0) {
		job.report.treesPending = true;
		return;
	}
	const keep: number = job.density.get(element.id) ?? 1;
	const plan: SlotPlan = planSlots(element, unit, job.segmentKey, side.sign, job.from, job.to, keep, 0, true);
	for (const slot of plan.slots) {
		const asset: TreeAsset = assets[Math.min(assets.length - 1, Math.floor(slot.variant * assets.length))];
		const curveFrame: CurveFrame = job.curve.frameAt(slot.distance);
		const lateral: number = lining.lateral + slot.lateral * element.jitter * Math.max(plan.step * 0.25, 0.3 * unit);
		const size: number = element.scale * (1 + slot.scale * element.scaleJitter);
		emitPropInstance(job.set, 'Trees', { positions: asset.positions, faces: asset.faces, atlas: asset.key }, frameFor(curveFrame, side, lateral, lining.baseY), slot.yaw, size, size, size);
	}
}

/** A rectangular section swept along the road: top plus both long sides. */
function sweepBox(job: LiningJob, ribbon: Ribbon, part: string, tile: string, lateral: number, width: number, y0: number, y1: number): void {
	const set: PartSet = job.set;
	emitBand(set, job.ctx.library, ribbon, { part, tile, lat0: lateral - width / 2, y0: y1, lat1: lateral + width / 2, y1 });
	emitRiser(set, job.ctx.library, ribbon, part, tile, lateral - width / 2, y0, y1, -1);
	emitRiser(set, job.ctx.library, ribbon, part, tile, lateral + width / 2, y0, y1, 1);
}

function emitSolidBox(job: LiningJob, side: ResolvedSide, lining: ResolvedLining, part: string, tile: string): void {
	const unit: number = job.profile.unit;
	const element: LiningElement = lining.element;
	const ribbon: Ribbon = makeRibbon(job.curve, job.from + element.endMargin * unit, job.to - element.endMargin * unit, unit, job.settings);
	if (ribbon.frames.length < 2) return;
	sweepBox(job, ribbon, part, tile, lining.lateral * side.sign, element.thickness * unit, lining.baseY, lining.baseY + element.height * unit);
}

/** W-beam rail with a corrugated face toward the road, plus posts. */
function emitGuardrail(job: LiningJob, side: ResolvedSide, lining: ResolvedLining): void {
	const unit: number = job.profile.unit;
	const element: LiningElement = lining.element;
	const from: number = job.from + element.endMargin * unit;
	const to: number = job.to - element.endMargin * unit;
	if (to - from < 0.5 * unit) return;
	const ribbon: Ribbon = makeBendRibbon(job.curve, from, to, unit, job.settings);
	const part: MeshPart = job.set.part('Guardrail', ROAD_ATLAS);
	const sign: number = side.sign;
	const base: number = lining.baseY;
	// Cross-section outline in (outward offset, height), front face first.
	const outline: Array<[number, number]> = [
		[-0.05, 0.6],
		[0, 0.69],
		[-0.05, 0.78],
		[0, 0.88],
		[-0.05, 0.98],
		[0.03, 0.98],
		[0.03, 0.6],
	];
	const uvs: Vec2[] = fullUvs(job.ctx.library, 'Guardrail New');
	for (let i: number = 0; i < ribbon.frames.length - 1; i++) {
		for (let k: number = 0; k < outline.length; k++) {
			const a: [number, number] = outline[k];
			const b: [number, number] = outline[(k + 1) % outline.length];
			const f0: CurveFrame = ribbon.frames[i];
			const f1: CurveFrame = ribbon.frames[i + 1];
			const lat = (o: number): number => (lining.lateral + o * unit) * sign;
			const corners: Vec3[] = [
				offsetPoint(f0, lat(a[0]), base + a[1] * unit),
				offsetPoint(f0, lat(b[0]), base + b[1] * unit),
				offsetPoint(f1, lat(b[0]), base + b[1] * unit),
				offsetPoint(f1, lat(a[0]), base + a[1] * unit),
			];
			// The outline runs counter-clockwise in (outward, up); face away from its centre.
			const mid: Vec3 = offsetPoint(f0, lat((a[0] + b[0]) / 2), base + ((a[1] + b[1]) / 2) * unit);
			const centre: Vec3 = offsetPoint(f0, lat(0.0), base + 0.79 * unit);
			job.set.polygon(part, corners, uvs, [mid[0] - centre[0], mid[1] - centre[1], mid[2] - centre[2]]);
		}
	}
	const post: PropSource = propSource(job.ctx.library, LINING_TYPES.guardrail.prop);
	const keep: number = job.density.get(element.id) ?? 1;
	const plan: SlotPlan = planSlots({ ...element, endMargin: element.endMargin }, unit, job.segmentKey, sign, job.from, job.to, keep, 0, false);
	for (const slot of plan.slots) {
		const frame: CurveFrame = job.curve.frameAt(slot.distance);
		emitPropInstance(job.set, 'Guardrail', post, frameFor(frame, side, lining.lateral + 0.04 * unit, base), 0, unit, unit, unit);
	}
}

/** Posts at regular spacing with two continuous rails. */
function emitFence(job: LiningJob, side: ResolvedSide, lining: ResolvedLining): void {
	const unit: number = job.profile.unit;
	const element: LiningElement = lining.element;
	const from: number = job.from + element.endMargin * unit;
	const to: number = job.to - element.endMargin * unit;
	if (to - from < 0.5 * unit) return;
	const tile: string = 'Guardrail Poles';
	const ribbon: Ribbon = makeBendRibbon(job.curve, from, to, unit, job.settings);
	const height: number = element.height * unit;
	const lateral: number = lining.lateral * side.sign;
	for (const level of [0.55, 0.92]) {
		sweepBox(job, ribbon, 'Fence', tile, lateral, 0.05 * unit, lining.baseY + height * level - 0.03 * unit, lining.baseY + height * level + 0.03 * unit);
	}
	const keep: number = job.density.get(element.id) ?? 1;
	const posts: SlotPlan = planSlots({ ...element, jitter: 0, density: 1 }, unit, job.segmentKey, side.sign, from, to, keep, 0, false);
	const postSource: PropSource = fencePost(job);
	for (const slot of posts.slots) {
		const frame: CurveFrame = job.curve.frameAt(slot.distance);
		emitPropInstance(job.set, 'Fence', postSource, frameFor(frame, side, lining.lateral, lining.baseY), 0, unit, height / 1, unit);
	}
}

function fencePost(job: LiningJob): PropSource {
	const w: number = 0.04;
	const tile: string = 'Guardrail Poles';
	const uvs: Vec2[] = fullUvs(job.ctx.library, tile);
	const positions: Vec3[] = [[-w, 0, -w], [w, 0, -w], [w, 0, w], [-w, 0, w], [-w, 1, -w], [w, 1, -w], [w, 1, w], [-w, 1, w]];
	const quads: number[][] = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]];
	return { name: 'Fence post', atlas: ROAD_ATLAS, positions, faces: quads.map((q: number[]) => ({ indices: q, uvs })), triangles: 10 };
}
