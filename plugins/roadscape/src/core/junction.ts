import type { MeshPart, Vec2, Vec3 } from './types';
import type { CurveFrame, RoadCurve } from './curve';
import { offsetPoint } from './curve';
import type { LiningElement, RoadNetwork, RoadSegment, Weather } from './model';
import type { NetworkIndex } from './network';
import { classifyNode, resolveProfileData, segmentCurve } from './network';
import type { PartSet } from './part_set';
import { resolveProfile } from './profile_resolve';
import type { ResolvedLining, ResolvedProfile, ResolvedSide, ResolvedStrip } from './profile_resolve';
import { UP, fullUvs, stripPartName } from './surface';
import { surfaceTile, tileSizeMeters } from './strip_library';
import type { RoadLibrary } from './library_types';
import { ROAD_ATLAS, propSource, tileUv } from './library_types';
import type { DensityMap, GenerationContext } from './context';
import { Rng, hashSeed } from './rng';
import { LINING_TYPES } from './lining_library';
import { emitPropInstance } from './instancing';
import type { InstanceFrame } from './instancing';
import { cross2, flatDirection, lerp, normalize, rightOf } from './vec';

/** One road leaving a junction node, seen from the node looking outward. */
export interface Arm {
	segment: RoadSegment;
	curve: RoadCurve;
	length: number;
	atStart: boolean;
	profile: ResolvedProfile;
	/** Horizontal unit direction leaving the node. */
	out: Vec3;
	/** Horizontal unit vector to the right when looking along `out`. */
	right: Vec3;
	angle: number;
	/** Side of the profile on the arm's right-hand side when looking away from the node. */
	near: ResolvedSide;
	far: ResolvedSide;
	setback: number;
}

export interface JunctionPlan {
	nodeId: string;
	centre: Vec3;
	arms: Arm[];
	cornerRadius: number;
	weather: Weather;
	/** True for a single arm that ends here. */
	cap: boolean;
}

/** A rounded corner chain between two arms for one layer ring. */
interface Corner {
	xz: Vec2[];
	/** Needed distance along each arm to the end of the straight part, or 0 when there is no fillet. */
	reachA: number;
	reachB: number;
}

const MIN_SETBACK: number = 0.5;
const SETBACK_MARGIN: number = 0.25;
const SEGMENT_SHARE: number = 0.48;

function v3(x: number, y: number, z: number): Vec3 {
	return [x, y, z];
}

function edgeAt(side: ResolvedSide, k: number): number {
	return side.edges[Math.min(k, side.edges.length - 1)];
}

function topAt(side: ResolvedSide, k: number): number {
	return side.tops[Math.min(k, side.tops.length - 1)];
}

/** Anticlockwise gap from arm `a` to arm `b`, in (0, 2π]. */
function gapBetween(a: Arm, b: Arm): number {
	let gap: number = b.angle - a.angle;
	while (gap <= 1e-6) gap += Math.PI * 2;
	return gap;
}

/** Rounded corner between the near edge of A (offset eA) and the far edge of B (offset eB). */
function makeCorner(centre: Vec3, a: Arm, eA: number, b: Arm, eB: number, gap: number, radius: number, segments: number): Corner {
	const pa: Vec3 = v3(centre[0] + a.right[0] * eA, 0, centre[2] + a.right[2] * eA);
	const pb: Vec3 = v3(centre[0] - b.right[0] * eB, 0, centre[2] - b.right[2] * eB);
	const straight: Corner = { xz: [], reachA: 0, reachB: 0 };
	const det: number = cross2(a.out, b.out);
	if (gap >= Math.PI - 0.05 || Math.abs(det) < 1e-6) return straight;
	// pa + out_a * t = pb + out_b * s
	const w: Vec3 = v3(pb[0] - pa[0], 0, pb[2] - pa[2]);
	const t: number = cross2(w, b.out) / det;
	const s: number = cross2(w, a.out) / det;
	if (t < 0 || s < 0) return straight;
	const x: Vec3 = v3(pa[0] + a.out[0] * t, 0, pa[2] + a.out[2] * t);
	const reach: number = radius / Math.tan(gap / 2);
	const ta: Vec2 = [x[0] + a.out[0] * reach, x[2] + a.out[2] * reach];
	const tb: Vec2 = [x[0] + b.out[0] * reach, x[2] + b.out[2] * reach];
	const bis: Vec3 = normalize(v3(a.out[0] + b.out[0], 0, a.out[2] + b.out[2]));
	const dist: number = radius / Math.sin(gap / 2);
	const o: Vec2 = [x[0] + bis[0] * dist, x[2] + bis[2] * dist];
	const a0: number = Math.atan2(ta[1] - o[1], ta[0] - o[0]);
	let delta: number = Math.atan2(tb[1] - o[1], tb[0] - o[0]) - a0;
	while (delta > Math.PI) delta -= Math.PI * 2;
	while (delta < -Math.PI) delta += Math.PI * 2;
	const xz: Vec2[] = [];
	for (let i: number = 0; i <= segments; i++) {
		const ang: number = a0 + (delta * i) / segments;
		xz.push([o[0] + Math.cos(ang) * radius, o[1] + Math.sin(ang) * radius]);
	}
	return { xz, reachA: t + reach, reachB: s + reach };
}

function buildArm(network: RoadNetwork, index: NetworkIndex, nodeId: string, segment: RoadSegment): Arm {
	const curve: RoadCurve = segmentCurve(network, index, segment);
	const atStart: boolean = segment.a === nodeId;
	const tangent: Vec3 = curve.endTangent(!atStart);
	const raw: Vec3 = atStart ? tangent : [-tangent[0], -tangent[1], -tangent[2]];
	const out: Vec3 = flatDirection(raw) ?? [0, 0, 1];
	const profile: ResolvedProfile = resolveProfile(resolveProfileData(network, segment.profile), network.settings.unitsPerMeter, network.settings.weather);
	return {
		segment,
		curve,
		length: curve.length,
		atStart,
		profile,
		out,
		right: rightOf(out),
		angle: Math.atan2(out[2], out[0]),
		near: atStart ? profile.right : profile.left,
		far: atStart ? profile.left : profile.right,
		setback: 0,
	};
}

/** Distance along the arm's own curve for a distance away from the node. */
function curveDistance(arm: Arm, away: number): number {
	return arm.atStart ? away : arm.length - away;
}

function frameFor(arm: Arm, away: number): CurveFrame {
	return arm.curve.frameAt(curveDistance(arm, away));
}

/** Works out the arms of a junction node, how far each road is set back, and the corner radius. */
export function planJunction(network: RoadNetwork, index: NetworkIndex, nodeId: string): JunctionPlan | null {
	const kind: string = classifyNode(network, index, nodeId);
	if (kind === 'through' || kind === 'isolated') return null;
	const unit: number = network.settings.unitsPerMeter;
	const nodePosition: Vec3 = (network.nodes.get(nodeId) as { position: Vec3 }).position;
	const segments: RoadSegment[] = index.incident.get(nodeId) as RoadSegment[];
	const arms: Arm[] = segments.map((s: RoadSegment): Arm => buildArm(network, index, nodeId, s));
	arms.sort((p: Arm, q: Arm): number => p.angle - q.angle);
	const node = network.nodes.get(nodeId) as { options: { cornerRadius: number } };
	const base: number = (node.options.cornerRadius >= 0 ? node.options.cornerRadius : network.settings.junction.cornerRadius) * unit;
	if (arms.length === 1) {
		return { nodeId, centre: nodePosition, arms, cornerRadius: 0, weather: network.settings.weather, cap: network.settings.junction.endCap === 'round' };
	}
	let radius: number = base;
	for (let attempt: number = 0; attempt < 5; attempt++) {
		const needed: Map<Arm, number> = measureSetbacks(network, nodePosition, arms, radius);
		let fits: boolean = true;
		for (const arm of arms) {
			const wanted: number = Math.max(MIN_SETBACK * unit, (needed.get(arm) ?? 0) + SETBACK_MARGIN * unit);
			arm.setback = wanted;
			if (wanted > arm.length * SEGMENT_SHARE) fits = false;
		}
		if (fits) break;
		radius *= 0.5;
	}
	for (const arm of arms) arm.setback = Math.min(arm.setback, arm.length * SEGMENT_SHARE);
	return { nodeId, centre: nodePosition, arms, cornerRadius: radius, weather: network.settings.weather, cap: false };
}

function layerRadius(radius: number, near: ResolvedSide, far: ResolvedSide, a: ResolvedSide, b: ResolvedSide, k: number): number {
	const grow: number = (edgeAt(near, k) - edgeAt(near, 0) + (edgeAt(far, k) - edgeAt(far, 0))) / 2;
	void a;
	void b;
	return Math.max(radius * 0.02, radius - grow);
}

function measureSetbacks(network: RoadNetwork, centre: Vec3, arms: Arm[], radius: number): Map<Arm, number> {
	const needed: Map<Arm, number> = new Map();
	const segments: number = Math.max(1, network.settings.junction.cornerSegments);
	for (let i: number = 0; i < arms.length; i++) {
		const a: Arm = arms[i];
		const b: Arm = arms[(i + 1) % arms.length];
		const gap: number = arms.length === 1 ? Math.PI * 2 : gapBetween(a, b);
		const layers: number = Math.max(a.near.edges.length, b.far.edges.length);
		for (let k: number = 0; k < layers; k++) {
			const r: number = layerRadius(radius, a.near, b.far, a.near, b.far, k);
			const corner: Corner = makeCorner(centre, a, edgeAt(a.near, k), b, edgeAt(b.far, k), gap, r, segments);
			needed.set(a, Math.max(needed.get(a) ?? 0, corner.reachA));
			needed.set(b, Math.max(needed.get(b) ?? 0, corner.reachB));
		}
	}
	return needed;
}

/** Heights of the carriageway surface at a signed offset across an arm. */
function carriageHeight(profile: ResolvedProfile, s: number): number {
	if (profile.carriageway.medianWidth > 0) return 0;
	return profile.carriageway.crown * profile.unit * (1 - Math.min(1, Math.abs(s) / profile.half));
}

/** Offsets across an arm, left to right, where its mouth needs a vertex. */
function mouthOffsets(profile: ResolvedProfile): number[] {
	const half: number = profile.half;
	const m: number = (profile.carriageway.medianWidth * profile.unit) / 2;
	if (m > 0) return [-half, -m, m, half];
	return profile.carriageway.crown * profile.unit > 1e-6 ? [-half, 0, half] : [-half, half];
}

interface RingPoint {
	xz: Vec2;
	ground: number;
}

function groundAt(plan: JunctionPlan, arm: Arm, xz: Vec2): number {
	const away: number = Math.max(0, (xz[0] - plan.centre[0]) * arm.out[0] + (xz[1] - plan.centre[2]) * arm.out[2]);
	const f: number = arm.setback > 1e-9 ? Math.min(1, away / arm.setback) : 1;
	const mouth: CurveFrame = frameFor(arm, arm.setback);
	return lerp(plan.centre[1], mouth.position[1], f);
}

/** Builds every ring chain of one corner: `rings[k]` runs from arm A's mouth to arm B's mouth. */
function cornerRings(plan: JunctionPlan, a: Arm, b: Arm, gap: number, layers: number, segments: number): RingPoint[][] {
	const rings: RingPoint[][] = [];
	const frameA: CurveFrame = frameFor(a, a.setback);
	const frameB: CurveFrame = frameFor(b, b.setback);
	for (let k: number = 0; k < layers; k++) {
		const eA: number = edgeAt(a.near, k);
		const eB: number = edgeAt(b.far, k);
		const r: number = layerRadius(plan.cornerRadius, a.near, b.far, a.near, b.far, k);
		const corner: Corner = makeCorner(plan.centre, a, eA, b, eB, gap, r, segments);
		const start: Vec3 = offsetPoint(frameA, a.near.sign * eA, 0);
		const end: Vec3 = offsetPoint(frameB, b.far.sign * eB, 0);
		const chain: RingPoint[] = [{ xz: [start[0], start[2]], ground: frameA.position[1] }];
		if (corner.xz.length > 0) {
			for (const p of corner.xz) chain.push({ xz: p, ground: 0 });
		} else {
			for (let i: number = 1; i <= segments; i++) {
				const u: number = i / (segments + 1);
				chain.push({ xz: [lerp(start[0], end[0], u), lerp(start[2], end[2], u)], ground: 0 });
			}
		}
		chain.push({ xz: [end[0], end[2]], ground: frameB.position[1] });
		const count: number = chain.length;
		for (let i: number = 1; i < count - 1; i++) {
			const u: number = i / (count - 1);
			const owner: Arm = u < 0.5 ? a : b;
			chain[i].ground = groundAt(plan, owner, chain[i].xz);
		}
		rings.push(chain);
	}
	return rings;
}

function stripFor(a: ResolvedSide, b: ResolvedSide, k: number): ResolvedStrip | undefined {
	return a.strips[k] ?? b.strips[k];
}

/** Top-down texture mapping at the same texel density as the roads, so patches blend with their arms. */
function planarUvs(library: RoadLibrary, tile: string, corners: Vec3[], unit: number): Vec2[] {
	const size: number = tileSizeMeters(tile) * unit;
	let cx: number = 0;
	let cz: number = 0;
	for (const c of corners) {
		cx += c[0];
		cz += c[2];
	}
	const ox: number = Math.floor(cx / corners.length / size);
	const oz: number = Math.floor(cz / corners.length / size);
	return corners.map((c: Vec3): Vec2 => tileUv(library, tile, c[0] / size - ox, c[2] / size - oz));
}

function pointOf(p: RingPoint, height: number): Vec3 {
	return v3(p.xz[0], p.ground + height, p.xz[1]);
}

function unitOf(plan: JunctionPlan): number {
	return plan.arms[0].profile.unit;
}

/** Emits asphalt, curb rings and risers of a junction patch. */
export function emitJunctionPatch(set: PartSet, ctx: GenerationContext, plan: JunctionPlan, segments: number): void {
	const arms: Arm[] = plan.arms;
	const asphalt: string = surfaceTile(arms[0].profile.carriageway.surface, plan.weather);
	const road: MeshPart = set.part('Road surface', ROAD_ATLAS);
	const loop: Vec3[] = [];
	const unit: number = unitOf(plan);
	let crown: number = 0;
	for (const arm of arms) crown = Math.max(crown, arm.profile.carriageway.crown * arm.profile.unit);
	const centre: Vec3 = v3(plan.centre[0], plan.centre[1] + (arms.some((a: Arm): boolean => a.profile.carriageway.medianWidth > 0) ? 0 : crown), plan.centre[2]);
	const chains: Array<{ a: Arm; b: Arm; layers: number; rings: RingPoint[][] }> = [];
	if (plan.cap) {
		const arm: Arm = arms[0];
		const rings: RingPoint[][] = capRings(plan, arm, Math.max(arm.near.edges.length, arm.far.edges.length), segments * 2);
		appendArm(loop, arm);
		for (const p of rings[0].slice(1, -1)) loop.push(pointOf(p, 0));
		chains.push({ a: arm, b: arm, layers: rings.length, rings });
	} else {
		for (let i: number = 0; i < arms.length; i++) {
			const a: Arm = arms[i];
			const b: Arm = arms[(i + 1) % arms.length];
			const gap: number = arms.length === 1 ? Math.PI * 2 : gapBetween(a, b);
			const layers: number = Math.max(a.near.edges.length, b.far.edges.length);
			const rings: RingPoint[][] = cornerRings(plan, a, b, gap, layers, segments);
			appendArm(loop, a);
			for (const p of rings[0].slice(1, -1)) loop.push(pointOf(p, 0));
			chains.push({ a, b, layers, rings });
		}
	}
	for (let i: number = 0; i < loop.length; i++) {
		const p: Vec3 = loop[i];
		const q: Vec3 = loop[(i + 1) % loop.length];
		const tri: Vec3[] = [centre, p, q];
		set.polygon(road, tri, planarUvs(ctx.library, asphalt, tri, unit), UP);
	}
	for (const chain of chains) emitCornerLayers(set, ctx, plan, chain.a, chain.b, chain.rings, chain.layers);
	for (const arm of arms) emitMedianEnd(set, ctx, arm, plan.weather);
}

function appendArm(loop: Vec3[], arm: Arm): void {
	const frame: CurveFrame = frameFor(arm, arm.setback);
	// Looking away from the node: left to right across the mouth.
	for (const s of mouthOffsets(arm.profile)) loop.push(offsetPoint(frame, arm.near.sign * s, carriageHeight(arm.profile, s)));
}

function emitMedianEnd(set: PartSet, ctx: GenerationContext, arm: Arm, weather: Weather): void {
	const median: number = (arm.profile.carriageway.medianWidth * arm.profile.unit) / 2;
	if (median <= 0) return;
	const frame: CurveFrame = frameFor(arm, arm.setback);
	const part: MeshPart = set.part('Median', ROAD_ATLAS);
	const top: number = 0.12 * arm.profile.unit;
	const toNode: Vec3 = v3(-arm.out[0], 0, -arm.out[2]);
	set.polygon(
		part,
		[offsetPoint(frame, -median, 0), offsetPoint(frame, median, 0), offsetPoint(frame, median, top), offsetPoint(frame, -median, top)],
		fullUvs(ctx.library, surfaceTile('concrete', weather)),
		toNode,
	);
}

function capRings(plan: JunctionPlan, arm: Arm, layers: number, segments: number): RingPoint[][] {
	const rings: RingPoint[][] = [];
	const frame: CurveFrame = frameFor(arm, 0);
	const base: number = frame.position[1];
	for (let k: number = 0; k < layers; k++) {
		const eR: number = edgeAt(arm.near, k);
		const eL: number = edgeAt(arm.far, k);
		const back: number = (eR + eL) / 2;
		const chain: RingPoint[] = [];
		for (let i: number = 0; i <= segments; i++) {
			const phi: number = (Math.PI * i) / segments;
			const c: number = Math.cos(phi);
			const across: number = c >= 0 ? eR * c : eL * c;
			const x: number = plan.centre[0] + arm.right[0] * across - arm.out[0] * Math.sin(phi) * back;
			const z: number = plan.centre[2] + arm.right[2] * across - arm.out[2] * Math.sin(phi) * back;
			chain.push({ xz: [x, z], ground: base });
		}
		rings.push(chain);
	}
	return rings;
}

function emitCornerLayers(set: PartSet, ctx: GenerationContext, plan: JunctionPlan, a: Arm, b: Arm, rings: RingPoint[][], layers: number): void {
	for (let k: number = 0; k < layers - 0; k++) {
		const strip: ResolvedStrip | undefined = stripFor(a.near, b.far, k);
		if (!strip) continue;
		const name: string = stripPartName(strip.element.type);
		const part: MeshPart = set.part(name, ROAD_ATLAS);
		const inner: RingPoint[] = rings[k];
		const outer: RingPoint[] = rings[k + 1] ?? rings[k];
		if (rings[k + 1] === undefined) continue;
		const count: number = inner.length;
		const uvs: Vec2[] = fullUvs(ctx.library, strip.tile);
		for (let j: number = 0; j < count - 1; j++) {
			const u0: number = j / (count - 1);
			const u1: number = (j + 1) / (count - 1);
			const h0: number = lerp(topAt(a.near, k + 1), topAt(b.far, k + 1), u0);
			const h1: number = lerp(topAt(a.near, k + 1), topAt(b.far, k + 1), u1);
			const quad: Vec3[] = [pointOf(inner[j], h0), pointOf(inner[j + 1], h1), pointOf(outer[j + 1], h1), pointOf(outer[j], h0)];
			set.polygon(part, quad, planarUvs(ctx.library, strip.tile, quad, unitOf(plan)), UP);
		}
		const rise: number = topAt(a.near, k + 1) - topAt(a.near, k);
		const riseB: number = topAt(b.far, k + 1) - topAt(b.far, k);
		if (Math.abs(rise) < 1e-4 && Math.abs(riseB) < 1e-4) continue;
		for (let j: number = 0; j < count - 1; j++) {
			const u0: number = j / (count - 1);
			const u1: number = (j + 1) / (count - 1);
			const lo0: number = lerp(topAt(a.near, k), topAt(b.far, k), u0);
			const hi0: number = lerp(topAt(a.near, k + 1), topAt(b.far, k + 1), u0);
			const lo1: number = lerp(topAt(a.near, k), topAt(b.far, k), u1);
			const hi1: number = lerp(topAt(a.near, k + 1), topAt(b.far, k + 1), u1);
			const mid: Vec3 = pointOf(inner[j], (lo0 + hi0) / 2);
			const toward: Vec3 = rise > 0 ? v3(plan.centre[0] - mid[0], 0, plan.centre[2] - mid[2]) : v3(mid[0] - plan.centre[0], 0, mid[2] - plan.centre[2]);
			set.polygon(part, [pointOf(inner[j], lo0), pointOf(inner[j], hi0), pointOf(inner[j + 1], hi1), pointOf(inner[j + 1], lo1)], uvs, toward);
		}
	}
}

/** Zebra crossings and stop lines at the mouth of every arm of a three-way or larger junction. */
export function emitJunctionMarkings(set: PartSet, ctx: GenerationContext, network: RoadNetwork, plan: JunctionPlan): void {
	if (plan.arms.length < 3) return;
	const part: MeshPart = set.part('Lane marking', ROAD_ATLAS);
	const unit: number = unitOf(plan);
	for (const arm of plan.arms) {
		const profile: ResolvedProfile = arm.profile;
		const lift: number = 0.018 * unit;
		const quad = (tile: string, d0: number, d1: number, s0: number, s1: number): void => {
			const f0: CurveFrame = frameFor(arm, d0);
			const f1: CurveFrame = frameFor(arm, d1);
			const y0: number = carriageHeight(profile, s0) + lift;
			const y1: number = carriageHeight(profile, s1) + lift;
			set.polygon(
				part,
				[offsetPoint(f0, arm.near.sign * s0, y0), offsetPoint(f0, arm.near.sign * s1, y1), offsetPoint(f1, arm.near.sign * s1, y1), offsetPoint(f1, arm.near.sign * s0, y0)],
				fullUvs(ctx.library, tile),
				UP,
			);
		};
		const tile: string = profile.carriageway.lineColor === 'yellow' ? 'Marking Yellow' : 'Marking';
		let at: number = arm.setback + 0.4 * unit;
		if (profile.carriageway.crosswalks === 'zebra') {
			const bar: number = 0.5 * unit;
			const length: number = 3 * unit;
			for (let s: number = -profile.half + 0.4 * unit; s + bar <= profile.half - 0.3 * unit; s += bar * 2) quad('Marking', at, at + length, s, s + bar);
			at += length + 0.6 * unit;
		}
		if (network.settings.junction.stopLines) {
			const m: number = (profile.carriageway.medianWidth * unit) / 2;
			// Traffic enters towards the node on the left of the arm when looking away from it.
			quad(tile, at, at + 0.4 * unit, -profile.half + 0.3 * unit, -m - 0.05 * unit);
		}
	}
}

/** Props that stand on every corner: lamps, bollards and so on. */
export function emitJunctionProps(set: PartSet, ctx: GenerationContext, plan: JunctionPlan, segments: number, density: DensityMap, spent: Map<string, number>): void {
	if (plan.cap || plan.arms.length < 2) return;
	const arms: Arm[] = plan.arms;
	for (let i: number = 0; i < arms.length; i++) {
		const a: Arm = arms[i];
		const b: Arm = arms[(i + 1) % arms.length];
		const gap: number = gapBetween(a, b);
		for (const lining of a.near.linings) {
			const element: LiningElement = lining.element;
			if (!element.atJunctions || !element.enabled) continue;
			const def = LINING_TYPES[element.type];
			if (def.mode !== 'instanced' || element.type === 'tree') continue;
			// The same stable roll the road-side rows use, so thinning removes corner props predictably.
			const keep: number = Math.min(1, element.density * (density.get(element.id) ?? 1));
			if (new Rng(hashSeed(`${element.seed}|${plan.nodeId}|${i}|${a.segment.key}`)).next() >= keep) continue;
			const before: number = set.triangles;
			placeCornerProp(set, ctx, plan, a, b, gap, lining, segments);
			spent.set(element.id, (spent.get(element.id) ?? 0) + set.triangles - before);
		}
	}
}

function placeCornerProp(set: PartSet, ctx: GenerationContext, plan: JunctionPlan, a: Arm, b: Arm, gap: number, lining: ResolvedLining, segments: number): void {
	const element: LiningElement = lining.element;
	const def = LINING_TYPES[element.type];
	const unit: number = unitOf(plan);
	const eA: number = lining.lateral;
	const match: ResolvedLining | undefined = b.far.linings.find((l: ResolvedLining): boolean => l.element.type === element.type);
	const eB: number = match ? match.lateral : eA;
	const grow: number = eA - edgeAt(a.near, 0);
	const r: number = Math.max(plan.cornerRadius * 0.02, plan.cornerRadius - grow);
	const corner: Corner = makeCorner(plan.centre, a, eA, b, eB, gap, r, segments);
	let xz: Vec2;
	if (corner.xz.length > 0) xz = corner.xz[Math.floor(corner.xz.length / 2)];
	else {
		const pa: Vec3 = v3(plan.centre[0] + a.right[0] * eA, 0, plan.centre[2] + a.right[2] * eA);
		const pb: Vec3 = v3(plan.centre[0] - b.right[0] * eB, 0, plan.centre[2] - b.right[2] * eB);
		xz = [(pa[0] + pb[0]) / 2, (pa[2] + pb[2]) / 2];
	}
	const toward: Vec3 = normalize(v3(plan.centre[0] - xz[0], 0, plan.centre[2] - xz[1]));
	// forward = inward x up keeps the local frame a pure rotation.
	const frame: InstanceFrame = {
		position: v3(xz[0], groundAt(plan, a, xz) + lining.baseY, xz[1]),
		inward: toward,
		forward: cross3(toward, UP),
	};
	const size: number = element.scale * unit;
	emitPropInstance(set, def.label, propSource(ctx.library, def.prop), frame, 0, size, size, size);
}

function cross3(a: Vec3, b: Vec3): Vec3 {
	return v3(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
}

/** How far a segment is set back at each end because of junctions. */
export function segmentSetbacks(plans: Map<string, JunctionPlan>, segment: RoadSegment): { start: number; end: number } {
	const at = (nodeId: string): number => {
		const plan: JunctionPlan | undefined = plans.get(nodeId);
		if (!plan || plan.cap) return 0;
		const arm: Arm | undefined = plan.arms.find((x: Arm): boolean => x.segment === segment);
		return arm ? arm.setback : 0;
	};
	return { start: at(segment.a), end: at(segment.b) };
}
