import { addNode, addSegment, createNetwork } from '../../../../roadscape/src/core/network';
import type { RoadNetwork } from '../../../../roadscape/src/core/model';
import { Rng, smoothstep } from '../math';
import type { Heightfield } from '../terrain/heightfield';
import type { Vec2 } from '../types';
import { circuitPoints } from './circuit';
import { buildGraph } from './graph';
import type { GraphEdge, GraphNode, PlanarGraph } from './graph';
import { StreamlineTracer } from './streamlines';
import type { DomainTest, Streamline, TracePass } from './streamlines';
import { TensorField, gridBasis, radialBasis, tensorOf, valueNoise } from './tensor';
import type { Basis } from './tensor';

export type LayoutKind = 'grid' | 'organic' | 'radial' | 'circuit';

export interface LayoutOptions {
	kind: LayoutKind;
	seed: number;
	/** Typical distance between parallel streets, metres. */
	blockSize: number;
	/** Share of the map the layout may cover. */
	coverage: number;
	/** Orientation of grids, degrees. */
	rotation: number;
	/** Number of centres that radial patterns grow around (organic layouts). */
	centers: number;
	/** Lay out wide main roads first, then fill with streets. */
	hierarchy: boolean;
	/** 0..1: how strongly streets run along hillsides instead of straight up them. */
	terrainFollow: number;
	/** 0..1: how much streets bend. */
	wiggle: number;
	/** Streets stay off ground steeper than this (rise over run). */
	maxSlope: number;
	profile: string;
	mainProfile: string;
	elevation: number;
	zone: boolean;
	district: number;
	zoneDepth: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
	kind: 'organic',
	seed: 1,
	blockSize: 70,
	coverage: 0.65,
	rotation: 0,
	centers: 3,
	hierarchy: true,
	terrainFollow: 0.6,
	wiggle: 0.35,
	maxSlope: 0.4,
	profile: 'street',
	mainProfile: 'avenue',
	elevation: 0.2,
	zone: true,
	district: 2,
	zoneDepth: 32,
};

interface Region {
	cx: number;
	cz: number;
	radius: number;
}

function clampNumber(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, n));
}

/** Ground where a street may run: dry, gentle and inside the shape of the layout. */
function makeDomain(hf: Heightfield, waterLevel: number, region: Region, options: LayoutOptions, angle: number, hubs: Vec2[], hole: number): DomainTest {
	const margin: number = hf.cellSize * 2;
	const cos: number = Math.cos(angle);
	const sin: number = Math.sin(angle);
	return (x: number, z: number): boolean => {
		if (x < hf.originX + margin || z < hf.originZ + margin || x > hf.originX + hf.width - margin || z > hf.originZ + hf.depth - margin) return false;
		const dx: number = x - region.cx;
		const dz: number = z - region.cz;
		if (options.kind === 'grid') {
			const u: number = dx * cos + dz * sin;
			const v: number = -dx * sin + dz * cos;
			if (Math.abs(u) > region.radius || Math.abs(v) > region.radius * 0.9) return false;
		} else {
			const a: number = Math.atan2(dz, dx);
			const bend: number = 1 + 0.16 * valueNoise(Math.cos(a) * 1.3 + 4, Math.sin(a) * 1.3 + 4, options.seed + 7);
			if (Math.hypot(dx, dz) > region.radius * bend) return false;
		}
		for (const h of hubs) if (Math.hypot(x - h[0], z - h[1]) < hole) return false;
		return hf.sample(x, z) >= waterLevel + 1 && hf.slope(x, z) <= options.maxSlope;
	};
}

/** The most buildable spot near the middle of the map, so layouts avoid lakes and mountains. */
function pickCenter(hf: Heightfield, waterLevel: number, radius: number, options: LayoutOptions): Vec2 {
	const mx: number = hf.originX + hf.width / 2;
	const mz: number = hf.originZ + hf.depth / 2;
	let best: Vec2 = [mx, mz];
	let bestScore: number = -Infinity;
	const reach: number = Math.min(hf.width, hf.depth) * 0.2;
	for (let i: number = -2; i <= 2; i++) {
		for (let j: number = -2; j <= 2; j++) {
			const cx: number = mx + (i / 2) * reach;
			const cz: number = mz + (j / 2) * reach;
			let good: number = 0;
			let total: number = 0;
			for (let k: number = 0; k < 48; k++) {
				const a: number = (k / 48) * Math.PI * 2;
				for (const f of [0.35, 0.75]) {
					const x: number = cx + Math.cos(a) * radius * f;
					const z: number = cz + Math.sin(a) * radius * f;
					total++;
					if (hf.containsWorld(x, z) && hf.sample(x, z) >= waterLevel + 1 && hf.slope(x, z) <= options.maxSlope) good++;
				}
			}
			const score: number = good / total - Math.hypot(i, j) * 0.01;
			if (score > bestScore) {
				bestScore = score;
				best = [cx, cz];
			}
		}
	}
	return best;
}

/** Streets that run along the contour lines on slopes. */
function contourBasis(hf: Heightfield, strength: number): Basis {
	const e: number = hf.cellSize * 1.5;
	return {
		at: (x: number, z: number) => {
			const gx: number = (hf.sample(x + e, z) - hf.sample(x - e, z)) / (2 * e);
			const gz: number = (hf.sample(x, z + e) - hf.sample(x, z - e)) / (2 * e);
			const slope: number = Math.hypot(gx, gz);
			return { weight: strength * 2.2 * smoothstep(0.04, 0.22, slope), tensor: tensorOf(Math.atan2(gx, -gz)) };
		},
	};
}

function buildField(hf: Heightfield, region: Region, centers: Vec2[], options: LayoutOptions, rng: Rng): TensorField {
	const field: TensorField = new TensorField(options.seed);
	const theta: number = (options.rotation * Math.PI) / 180;
	const R: number = region.radius;
	if (options.kind === 'grid') {
		field.add(gridBasis(region.cx, region.cz, R * 4, 0, theta, 1));
		field.noiseAngle = options.wiggle * 0.25;
	} else if (options.kind === 'radial') {
		field.add(radialBasis(region.cx, region.cz, R * 1.3, 0.7, 1));
		field.add(gridBasis(region.cx, region.cz, R * 3, 0.2, theta, 0.3));
		field.noiseAngle = options.wiggle * 0.3;
	} else {
		// Each centre grows rings and spokes that give way, further out, to a grid of its own orientation.
		for (const c of centers) {
			field.add(radialBasis(c[0], c[1], R * 0.45, 2, 1.3));
			field.add(gridBasis(c[0], c[1], R * 0.75, 1, theta + rng.range(-Math.PI / 2, Math.PI / 2), 0.9));
		}
		field.add(gridBasis(region.cx, region.cz, R * 5, 0, theta, 0.2));
		field.noiseAngle = options.wiggle * 1.4;
	}
	field.noiseScale = Math.max(100, options.blockSize * 3);
	if (options.terrainFollow > 0) field.add(contourBasis(hf, options.terrainFollow));
	return field;
}

/**
 * A deterministic, editable road layout. Streets follow a tensor field (grids that melt into radial
 * patterns around centres and bend along hillsides) and are placed with evenly spaced streamlines, as in
 * Chen et al., "Interactive Procedural Street Modeling" (SIGGRAPH 2008). Main roads are laid out first
 * with wide spacing, then streets fill in, closer together near the centres. The result is a plain
 * Roadscape control graph, never a baked mesh.
 */
export function generateLayout(hf: Heightfield, waterLevel: number, unit: number, options: LayoutOptions): RoadNetwork {
	const network: RoadNetwork = createNetwork({ unitsPerMeter: unit, defaultProfile: options.profile, seed: options.seed });
	const coverage: number = clampNumber(options.coverage, 0.1, 0.9);
	const angle: number = (options.rotation * Math.PI) / 180;
	const rng: Rng = new Rng(options.seed);
	const radius: number = (Math.min(hf.width, hf.depth) * coverage) / 2;
	const lift: number = options.elevation;
	const height = (x: number, z: number): number => hf.sample(x, z) + lift;

	if (options.kind === 'circuit') {
		const width: number = Math.min(hf.width, hf.depth) * coverage;
		const mx: number = hf.originX + hf.width / 2;
		const mz: number = hf.originZ + hf.depth / 2;
		const points: Vec2[] = circuitPoints(width, 40, options.seed);
		points.forEach((p: Vec2, i: number): void => {
			const x: number = mx + p[0] * Math.cos(angle) - p[1] * Math.sin(angle);
			const z: number = mz + p[0] * Math.sin(angle) + p[1] * Math.cos(angle);
			addNode(network, `p${i}`, [x * unit, Math.max(height(x, z), waterLevel + 1.5 + lift) * unit, z * unit]);
		});
		for (let i: number = 0; i < points.length; i++) addSegment(network, `p${i}`, `p${(i + 1) % points.length}`);
		return network;
	}

	const centre: Vec2 = pickCenter(hf, waterLevel, radius, options);
	const region: Region = { cx: centre[0], cz: centre[1], radius };
	const centers: Vec2[] = [centre];
	const wanted: number = clampNumber(Math.round(options.centers), 1, 5);
	for (let tries: number = 0; centers.length < wanted && tries < 80; tries++) {
		const a: number = rng.range(0, Math.PI * 2);
		const d: number = rng.range(0.35, 0.7) * radius;
		const c: Vec2 = [centre[0] + Math.cos(a) * d, centre[1] + Math.sin(a) * d];
		if (centers.every((o: Vec2): boolean => Math.hypot(o[0] - c[0], o[1] - c[1]) > radius * 0.45)) centers.push(c);
	}

	// Radial patterns have a singular point in the middle; leave a small plaza there instead of a tangle.
	const hubs: Vec2[] = options.kind === 'grid' ? [] : options.kind === 'radial' ? [centre] : centers;
	const domain: DomainTest = makeDomain(hf, waterLevel, region, options, angle, hubs, clampNumber(options.blockSize, 20, 400) * 0.55);
	const field: TensorField = buildField(hf, region, centers, options, rng);
	const block: number = clampNumber(options.blockSize, 20, 400);
	const step: number = clampNumber(block / 8, 3, 8);
	const bounds = { minX: region.cx - radius * 1.2, maxX: region.cx + radius * 1.2, minZ: region.cz - radius * 1.2, maxZ: region.cz + radius * 1.2 };
	const tracer: StreamlineTracer = new StreamlineTracer(field, domain, bounds, rng, step);

	// Blocks are smaller near the centres and larger toward the edge.
	const density = (x: number, z: number): number => {
		if (options.kind === 'grid') return 1;
		let nearest: number = Infinity;
		for (const c of centers) nearest = Math.min(nearest, Math.hypot(x - c[0], z - c[1]));
		return 0.75 + 0.5 * smoothstep(0, radius, nearest);
	};
	const passes: TracePass[] = [];
	if (options.hierarchy) {
		const main = (x: number, z: number): number => block * 3.2 * density(x, z);
		for (const dir of [0, 1] as const) passes.push({ dir, rank: 'main', spacing: main, minLength: block * 2.5, maxLength: radius * 6, minJoinAngle: 0.5 });
	}
	const local = (x: number, z: number): number => block * density(x, z);
	for (const dir of [0, 1] as const) passes.push({ dir, rank: 'street', spacing: local, minLength: block * 1.2, maxLength: radius * 6, minJoinAngle: 0.45 });
	const lines: Streamline[] = [];
	for (const pass of passes) lines.push(...tracer.run(pass));

	const graph: PlanarGraph = buildGraph(lines, { simplify: Math.max(1, step * 0.4), snap: block * 0.35, minEdge: block * 0.18, spur: block * 0.5 });
	if (graph.edges.length === 0) throw new Error('There is no flat dry ground to lay streets on. Lower the water level, raise the coverage or flatten some land.');
	const ids: Map<number, string> = new Map();
	for (const n of graph.nodes.values() as Iterable<GraphNode>) {
		const id: string = `n${n.id}`;
		ids.set(n.id, id);
		addNode(network, id, [n.x * unit, height(n.x, n.z) * unit, n.z * unit]);
	}
	for (const e of graph.edges as GraphEdge[]) {
		addSegment(network, ids.get(e.a) as string, ids.get(e.b) as string, { profile: e.rank === 'main' ? options.mainProfile : options.profile, smooth: options.kind !== 'grid' });
	}
	return network;
}
