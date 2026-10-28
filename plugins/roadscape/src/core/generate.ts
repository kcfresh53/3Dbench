import type { MeshPart, Vec3 } from './types';
import { triangleCount } from './types';
import type { RoadCurve } from './curve';
import type { NetworkSettings, RoadNetwork, RoadNode, RoadProfile, RoadSegment } from './model';
import { buildIndex, resolveProfileData, segmentCurve } from './network';
import type { NetworkIndex } from './network';
import { PartSet, mergeParts } from './part_set';
import { resolveProfile } from './profile_resolve';
import type { ResolvedProfile } from './profile_resolve';
import { emitCarriageway, emitSide, makeRibbon } from './surface';
import type { Ribbon } from './surface';
import { emitMarkings } from './markings';
import { emitLinings } from './lining_emit';
import { emitMedianBarrier, emitStructure, resolveStructure } from './structures';
import type { ResolvedStructure } from './structures';
import { emitJunctionMarkings, emitJunctionPatch, emitJunctionProps, planJunction, segmentSetbacks } from './junction';
import type { Arm, JunctionPlan } from './junction';
import type { BuildReport, DensityMap, GenerationContext } from './context';
import { newReport } from './context';
import { LINING_TYPES } from './lining_library';
import type { LiningDefinition } from './lining_library';

interface CachedChunk {
	signature: string;
	parts: MeshPart[];
	triangles: number;
	liningTriangles: Map<string, number>;
	treesPending: boolean;
}

/** Remembers generated geometry per road segment and per junction between rebuilds. */
export class GenerationCache {
	private segments: Map<string, CachedChunk> = new Map();
	private junctions: Map<string, CachedChunk> = new Map();

	clear(): void {
		this.segments.clear();
		this.junctions.clear();
	}

	sweep(liveSegments: Set<string>, liveJunctions: Set<string>): void {
		for (const key of [...this.segments.keys()]) if (!liveSegments.has(key)) this.segments.delete(key);
		for (const key of [...this.junctions.keys()]) if (!liveJunctions.has(key)) this.junctions.delete(key);
	}

	segment(key: string): CachedChunk | undefined {
		return this.segments.get(key);
	}

	junction(key: string): CachedChunk | undefined {
		return this.junctions.get(key);
	}

	storeSegment(key: string, chunk: CachedChunk): void {
		this.segments.set(key, chunk);
	}

	storeJunction(key: string, chunk: CachedChunk): void {
		this.junctions.set(key, chunk);
	}
}

export interface GenerateResult {
	parts: MeshPart[];
	triangles: number;
	/** Triangles per part name. */
	breakdown: Record<string, number>;
	report: BuildReport;
	/** Density multipliers that were applied to meet the budget. */
	density: DensityMap;
}

function round(n: number): number {
	return Math.round(n * 1e4) / 1e4;
}

function vecKey(v: Vec3): string {
	return `${round(v[0])},${round(v[1])},${round(v[2])}`;
}

function curveKey(curve: RoadCurve): string {
	return [curve.p0, curve.c0, curve.c1, curve.p1].map(vecKey).join(';');
}

function settingsKey(s: NetworkSettings): string {
	return JSON.stringify([s.unitsPerMeter, s.groundY, s.weather, s.curveError, s.seed, s.structures, s.junction.stopLines, s.junction.cornerSegments]);
}

function densityKey(profile: RoadProfile, density: DensityMap): string {
	const parts: string[] = [];
	for (const e of [...profile.left, ...profile.right]) {
		const d: number | undefined = density.get(e.id);
		if (d !== undefined && d < 1) parts.push(`${e.id}:${round(d)}`);
	}
	return parts.join(',');
}

interface SegmentOutput {
	chunk: CachedChunk;
}

function generateSegment(network: RoadNetwork, index: NetworkIndex, ctx: GenerationContext, plans: Map<string, JunctionPlan>, segment: RoadSegment, density: DensityMap, cache: GenerationCache | null): SegmentOutput | null {
	const settings: NetworkSettings = network.settings;
	const unit: number = settings.unitsPerMeter;
	const curve: RoadCurve = segmentCurve(network, index, segment);
	const { start, end }: { start: number; end: number } = segmentSetbacks(plans, segment);
	const from: number = start;
	const to: number = curve.length - end;
	if (to - from < 0.2 * unit) return null;
	const profileData: RoadProfile = resolveProfileData(network, segment.profile);
	const structure: ResolvedStructure = resolveStructure(segment, profileData, curve, settings);
	const signature: string = JSON.stringify([curveKey(curve), round(from), round(to), profileData, structure, settingsKey(settings), densityKey(profileData, density), ctx.trees.revision, segment.key]);
	const cached: CachedChunk | undefined = cache?.segment(segment.key);
	if (cached && cached.signature === signature) return { chunk: cached };
	const profile: ResolvedProfile = resolveProfile(profileData, unit, settings.weather);
	const set: PartSet = new PartSet();
	const report: BuildReport = newReport();
	const ribbon: Ribbon = makeRibbon(curve, from, to, unit, settings);
	emitCarriageway(set, ctx.library, ribbon, profile, settings);
	emitSide(set, ctx.library, ribbon, profile.left);
	emitSide(set, ctx.library, ribbon, profile.right);
	emitMarkings(set, ctx.library, curve, from, to, profile, settings);
	emitStructure({ set, ctx, settings, profile, curve, ribbon, from, to, structure });
	emitMedianBarrier({ set, ctx, profile, curve, from, to });
	emitLinings({ set, ctx, report, settings, profile, curve, from, to, segmentKey: segment.key, structure, density });
	const chunk: CachedChunk = { signature, parts: set.all(), triangles: set.triangles, liningTriangles: report.liningTriangles, treesPending: report.treesPending };
	cache?.storeSegment(segment.key, chunk);
	return { chunk };
}

function junctionSignature(network: RoadNetwork, plan: JunctionPlan, ctx: GenerationContext, density: DensityMap): string {
	const arms: string[] = plan.arms.map((arm: Arm): string => {
		const data: RoadProfile = resolveProfileData(network, arm.segment.profile);
		return `${curveKey(arm.curve)}|${round(arm.setback)}|${arm.atStart}|${JSON.stringify(data)}|${densityKey(data, density)}`;
	});
	return JSON.stringify([plan.nodeId, vecKey(plan.centre), round(plan.cornerRadius), plan.cap, arms, settingsKey(network.settings), ctx.trees.revision]);
}

function generateJunction(network: RoadNetwork, ctx: GenerationContext, plan: JunctionPlan, density: DensityMap, cache: GenerationCache | null): CachedChunk | null {
	const signature: string = junctionSignature(network, plan, ctx, density);
	const cached: CachedChunk | undefined = cache?.junction(plan.nodeId);
	if (cached && cached.signature === signature) return cached;
	const set: PartSet = new PartSet();
	const spent: Map<string, number> = new Map();
	const segments: number = Math.max(1, network.settings.junction.cornerSegments);
	if (plan.arms.length > 1 || plan.cap) {
		emitJunctionPatch(set, ctx, plan, segments);
		emitJunctionMarkings(set, ctx, network, plan);
		emitJunctionProps(set, ctx, plan, segments, density, spent);
	}
	const chunk: CachedChunk = { signature, parts: set.all(), triangles: set.triangles, liningTriangles: spent, treesPending: false };
	cache?.storeJunction(plan.nodeId, chunk);
	return chunk;
}

function collectPlans(network: RoadNetwork, index: NetworkIndex): Map<string, JunctionPlan> {
	const plans: Map<string, JunctionPlan> = new Map();
	for (const node of network.nodes.values() as IterableIterator<RoadNode>) {
		const plan: JunctionPlan | null = planJunction(network, index, node.id);
		if (plan) plans.set(node.id, plan);
	}
	return plans;
}

function build(network: RoadNetwork, ctx: GenerationContext, density: DensityMap, cache: GenerationCache | null): GenerateResult {
	const index: NetworkIndex = buildIndex(network);
	const plans: Map<string, JunctionPlan> = collectPlans(network, index);
	const report: BuildReport = newReport();
	const chunks: CachedChunk[] = [];
	const liveSegments: Set<string> = new Set();
	const liveJunctions: Set<string> = new Set();
	for (const segment of network.segments.values()) {
		const out: SegmentOutput | null = generateSegment(network, index, ctx, plans, segment, density, cache);
		if (!out) continue;
		liveSegments.add(segment.key);
		chunks.push(out.chunk);
	}
	for (const plan of plans.values()) {
		const chunk: CachedChunk | null = generateJunction(network, ctx, plan, density, cache);
		if (!chunk) continue;
		liveJunctions.add(plan.nodeId);
		chunks.push(chunk);
	}
	cache?.sweep(liveSegments, liveJunctions);
	const all: MeshPart[] = [];
	for (const chunk of chunks) {
		for (const part of chunk.parts) all.push(part);
		if (chunk.treesPending) report.treesPending = true;
		for (const [id, tris] of chunk.liningTriangles) report.liningTriangles.set(id, (report.liningTriangles.get(id) ?? 0) + tris);
	}
	const parts: MeshPart[] = mergeParts(all);
	const breakdown: Record<string, number> = {};
	let triangles: number = 0;
	for (const part of parts) {
		const count: number = triangleCount(part.faces);
		breakdown[part.name] = (breakdown[part.name] ?? 0) + count;
		triangles += count;
	}
	return { parts, triangles, breakdown, report, density };
}

function findLining(network: RoadNetwork, id: string): LiningDefinition | null {
	const profiles: RoadProfile[] = [];
	for (const s of network.segments.values()) profiles.push(resolveProfileData(network, s.profile));
	for (const p of profiles) {
		for (const e of [...p.left, ...p.right]) if (e.kind === 'lining' && e.id === id) return LINING_TYPES[e.type];
	}
	return null;
}

/**
 * Generates the whole network. When the budget is enforced and exceeded, repeated props are thinned
 * in the order set by each lining type (trees first, structural rails last) rather than swapping models.
 */
export function generateNetwork(network: RoadNetwork, ctx: GenerationContext, cache: GenerationCache | null = null): GenerateResult {
	const density: DensityMap = new Map();
	let result: GenerateResult = build(network, ctx, density, cache);
	const budget = network.settings.budget;
	if (!budget.enforce) return result;
	for (let pass: number = 0; pass < 4 && result.triangles > budget.maxTriangles; pass++) {
		let excess: number = result.triangles - budget.maxTriangles;
		const candidates: Array<{ id: string; tris: number; def: LiningDefinition }> = [];
		for (const [id, tris] of result.report.liningTriangles) {
			const def: LiningDefinition | null = findLining(network, id);
			if (def && def.mode === 'instanced' && tris > 0) candidates.push({ id, tris, def });
		}
		candidates.sort((a, b): number => a.def.thinOrder - b.def.thinOrder || b.tris - a.tris);
		for (const c of candidates) {
			if (excess <= 0) break;
			const cut: number = Math.min(c.tris, excess * 1.05);
			const current: number = density.get(c.id) ?? 1;
			density.set(c.id, Math.max(0, current * (1 - cut / c.tris)));
			excess -= cut;
		}
		result = build(network, ctx, density, cache);
	}
	if (result.triangles > budget.maxTriangles) result.report.warnings.push(`Road needs ${result.triangles} triangles, over the ${budget.maxTriangles} budget. Remove props or shorten the road.`);
	return result;
}
