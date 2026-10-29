import type { Vec2 } from '../types';
import type { Streamline, StreetRank } from './streamlines';

export interface GraphNode {
	id: number;
	x: number;
	z: number;
}

export interface GraphEdge {
	a: number;
	b: number;
	rank: StreetRank;
}

export interface PlanarGraph {
	nodes: Map<number, GraphNode>;
	edges: GraphEdge[];
}

export interface GraphOptions {
	/** Largest deviation allowed when thinning a street to few control points, metres. */
	simplify: number;
	/** Street ends this close to another street join it, metres. */
	snap: number;
	/** Streets between junctions shorter than this are merged away, metres. */
	minEdge: number;
	/** Dead ends shorter than this are removed, metres. */
	spur: number;
}

function pointToSegment(px: number, pz: number, a: Vec2, b: Vec2): { t: number; x: number; z: number; d: number } {
	const dx: number = b[0] - a[0];
	const dz: number = b[1] - a[1];
	const l2: number = dx * dx + dz * dz;
	const t: number = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2));
	const x: number = a[0] + dx * t;
	const z: number = a[1] + dz * t;
	return { t, x, z, d: Math.hypot(px - x, pz - z) };
}

/** Douglas–Peucker thinning that keeps the end points. */
export function simplifyLine(points: Vec2[], tolerance: number): Vec2[] {
	if (points.length <= 2) return points.slice();
	const keep: boolean[] = new Array<boolean>(points.length).fill(false);
	keep[0] = keep[points.length - 1] = true;
	const stack: Array<[number, number]> = [[0, points.length - 1]];
	while (stack.length > 0) {
		const [lo, hi] = stack.pop() as [number, number];
		let far: number = -1;
		let farD: number = tolerance;
		for (let i: number = lo + 1; i < hi; i++) {
			const d: number = pointToSegment(points[i][0], points[i][1], points[lo], points[hi]).d;
			if (d > farD) {
				far = i;
				farD = d;
			}
		}
		if (far >= 0) {
			keep[far] = true;
			stack.push([lo, far], [far, hi]);
		}
	}
	return points.filter((_: Vec2, i: number): boolean => keep[i]);
}

interface Piece {
	line: number;
	a: Vec2;
	b: Vec2;
	/** Where other streets cross or end on this piece: parameter along it and the point. */
	cuts: Array<{ t: number; x: number; z: number }>;
}

function crossing(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { t: number; u: number } | null {
	const rx: number = b[0] - a[0];
	const rz: number = b[1] - a[1];
	const sx: number = d[0] - c[0];
	const sz: number = d[1] - c[1];
	const denom: number = rx * sz - rz * sx;
	if (Math.abs(denom) < 1e-9) return null;
	const t: number = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / denom;
	const u: number = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / denom;
	return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

/**
 * Turns traced streets into a road graph: thins each street to a few control points, ends dangling
 * streets on whatever they nearly touch, splits every street where others cross, merges tiny edges,
 * strips short dead ends and keeps the largest connected piece.
 */
export function buildGraph(lines: Streamline[], options: GraphOptions): PlanarGraph {
	const thin: Vec2[][] = lines.map((l: Streamline): Vec2[] => simplifyLine(l.points, options.simplify));
	const pieces: Piece[] = [];
	const owner: number[][] = thin.map((): number[] => []);
	thin.forEach((points: Vec2[], line: number): void => {
		for (let i: number = 0; i + 1 < points.length; i++) {
			owner[line].push(pieces.length);
			pieces.push({ line, a: points[i], b: points[i + 1], cuts: [] });
		}
	});

	// Bucket the pieces so each query only looks at its neighbours.
	const cell: number = Math.max(options.snap * 2, 30);
	const buckets: Map<string, number[]> = new Map();
	const bucketKeys = (a: Vec2, b: Vec2, pad: number): string[] => {
		const keys: string[] = [];
		const x0: number = Math.floor((Math.min(a[0], b[0]) - pad) / cell);
		const x1: number = Math.floor((Math.max(a[0], b[0]) + pad) / cell);
		const z0: number = Math.floor((Math.min(a[1], b[1]) - pad) / cell);
		const z1: number = Math.floor((Math.max(a[1], b[1]) + pad) / cell);
		for (let x: number = x0; x <= x1; x++) for (let z: number = z0; z <= z1; z++) keys.push(`${x},${z}`);
		return keys;
	};
	const index = (): void => {
		buckets.clear();
		pieces.forEach((p: Piece, i: number): void => {
			for (const k of bucketKeys(p.a, p.b, 0)) {
				const list: number[] | undefined = buckets.get(k);
				if (list) list.push(i);
				else buckets.set(k, [i]);
			}
		});
	};
	const nearby = (a: Vec2, b: Vec2, pad: number): Set<number> => {
		const found: Set<number> = new Set();
		for (const k of bucketKeys(a, b, pad)) for (const i of buckets.get(k) ?? []) found.add(i);
		return found;
	};
	index();

	// 1. Street ends snap onto the nearest piece of another street, or a far part of their own (rings).
	thin.forEach((points: Vec2[], line: number): void => {
		for (const end of [0, points.length - 1]) {
			const p: Vec2 = points[end];
			const ownPiece: number = end === 0 ? owner[line][0] : owner[line][owner[line].length - 1];
			let best: { piece: number; t: number; x: number; z: number; d: number } | null = null;
			for (const i of nearby(p, p, options.snap)) {
				if (i === ownPiece) continue;
				if (pieces[i].line === line && Math.abs(owner[line].indexOf(i) - owner[line].indexOf(ownPiece)) < 3) continue;
				const r = pointToSegment(p[0], p[1], pieces[i].a, pieces[i].b);
				if (r.d <= options.snap && (!best || r.d < best.d)) best = { piece: i, ...r };
			}
			if (best) {
				points[end] = [best.x, best.z];
				const own: Piece = pieces[ownPiece];
				if (end === 0) own.a = points[0];
				else own.b = points[points.length - 1];
				pieces[best.piece].cuts.push({ t: best.t, x: best.x, z: best.z });
			}
		}
	});
	index();

	// 2. Crossings between different streets.
	for (let i: number = 0; i < pieces.length; i++) {
		for (const j of nearby(pieces[i].a, pieces[i].b, 0)) {
			if (j <= i || pieces[j].line === pieces[i].line) continue;
			const hit = crossing(pieces[i].a, pieces[i].b, pieces[j].a, pieces[j].b);
			if (!hit) continue;
			const x: number = pieces[i].a[0] + (pieces[i].b[0] - pieces[i].a[0]) * hit.t;
			const z: number = pieces[i].a[1] + (pieces[i].b[1] - pieces[i].a[1]) * hit.t;
			pieces[i].cuts.push({ t: hit.t, x, z });
			pieces[j].cuts.push({ t: hit.u, x, z });
		}
	}

	// 3. Nodes (shared within a small tolerance) and edges.
	const nodes: Map<number, GraphNode> = new Map();
	const nodeCells: Map<string, number[]> = new Map();
	const tolerance: number = Math.max(1.5, options.snap * 0.25);
	const nodeAt = (x: number, z: number): number => {
		const cx: number = Math.floor(x / tolerance);
		const cz: number = Math.floor(z / tolerance);
		for (let i: number = -1; i <= 1; i++) {
			for (let j: number = -1; j <= 1; j++) {
				for (const id of nodeCells.get(`${cx + i},${cz + j}`) ?? []) {
					const n: GraphNode = nodes.get(id) as GraphNode;
					if (Math.hypot(n.x - x, n.z - z) <= tolerance) return id;
				}
			}
		}
		const id: number = nodes.size;
		nodes.set(id, { id, x, z });
		const key: string = `${cx},${cz}`;
		const list: number[] | undefined = nodeCells.get(key);
		if (list) list.push(id);
		else nodeCells.set(key, [id]);
		return id;
	};
	const edges: Map<string, GraphEdge> = new Map();
	const addEdge = (a: number, b: number, rank: StreetRank): void => {
		if (a === b) return;
		const key: string = a < b ? `${a}:${b}` : `${b}:${a}`;
		const existing: GraphEdge | undefined = edges.get(key);
		if (existing) {
			if (rank === 'main') existing.rank = 'main';
		} else edges.set(key, { a, b, rank });
	};
	for (const piece of pieces) {
		const rank: StreetRank = lines[piece.line].rank;
		const stops: Array<{ t: number; x: number; z: number }> = [{ t: 0, x: piece.a[0], z: piece.a[1] }, ...piece.cuts.slice().sort((p, q) => p.t - q.t), { t: 1, x: piece.b[0], z: piece.b[1] }];
		let previous: number = nodeAt(stops[0].x, stops[0].z);
		for (let i: number = 1; i < stops.length; i++) {
			const id: number = nodeAt(stops[i].x, stops[i].z);
			addEdge(previous, id, rank);
			previous = id;
		}
	}
	const graph: PlanarGraph = { nodes, edges: [...edges.values()] };
	mergeShortEdges(graph, options.minEdge);
	pruneSpurs(graph, options.spur);
	keepLargest(graph);
	return graph;
}

function lengthOf(g: PlanarGraph, e: GraphEdge): number {
	const a: GraphNode = g.nodes.get(e.a) as GraphNode;
	const b: GraphNode = g.nodes.get(e.b) as GraphNode;
	return Math.hypot(a.x - b.x, a.z - b.z);
}

function dedupe(g: PlanarGraph): void {
	const seen: Map<string, GraphEdge> = new Map();
	for (const e of g.edges) {
		if (e.a === e.b) continue;
		const key: string = e.a < e.b ? `${e.a}:${e.b}` : `${e.b}:${e.a}`;
		const old: GraphEdge | undefined = seen.get(key);
		if (old) {
			if (e.rank === 'main') old.rank = 'main';
		} else seen.set(key, e);
	}
	g.edges = [...seen.values()];
}

/** Collapses edges shorter than `minEdge` by moving one end onto the other. */
function mergeShortEdges(g: PlanarGraph, minEdge: number): void {
	for (let pass: number = 0; pass < 50; pass++) {
		const short: GraphEdge | undefined = g.edges.find((e: GraphEdge): boolean => lengthOf(g, e) < minEdge);
		if (!short) break;
		const keep: GraphNode = g.nodes.get(short.a) as GraphNode;
		const drop: GraphNode = g.nodes.get(short.b) as GraphNode;
		keep.x = (keep.x + drop.x) / 2;
		keep.z = (keep.z + drop.z) / 2;
		for (const e of g.edges) {
			if (e.a === drop.id) e.a = keep.id;
			if (e.b === drop.id) e.b = keep.id;
		}
		g.nodes.delete(drop.id);
		dedupe(g);
	}
}

function degrees(g: PlanarGraph): Map<number, number> {
	const d: Map<number, number> = new Map();
	for (const e of g.edges) {
		d.set(e.a, (d.get(e.a) ?? 0) + 1);
		d.set(e.b, (d.get(e.b) ?? 0) + 1);
	}
	return d;
}

/** Removes dead-end stubs shorter than `spur`, repeatedly, so short branches vanish entirely. */
function pruneSpurs(g: PlanarGraph, spur: number): void {
	for (let pass: number = 0; pass < 8; pass++) {
		const deg: Map<number, number> = degrees(g);
		const before: number = g.edges.length;
		g.edges = g.edges.filter((e: GraphEdge): boolean => !(((deg.get(e.a) ?? 0) === 1 || (deg.get(e.b) ?? 0) === 1) && lengthOf(g, e) < spur));
		if (g.edges.length === before) break;
	}
	const used: Set<number> = new Set(g.edges.flatMap((e: GraphEdge): number[] => [e.a, e.b]));
	for (const id of [...g.nodes.keys()]) if (!used.has(id)) g.nodes.delete(id);
}

function keepLargest(g: PlanarGraph): void {
	const parent: Map<number, number> = new Map([...g.nodes.keys()].map((id: number): [number, number] => [id, id]));
	const find = (x: number): number => {
		let r: number = x;
		while (parent.get(r) !== r) r = parent.get(r) as number;
		parent.set(x, r);
		return r;
	};
	for (const e of g.edges) parent.set(find(e.a), find(e.b));
	const size: Map<number, number> = new Map();
	for (const e of g.edges) size.set(find(e.a), (size.get(find(e.a)) ?? 0) + 1);
	let best: number = -1;
	let bestSize: number = 0;
	for (const [root, n] of size) {
		if (n > bestSize) {
			best = root;
			bestSize = n;
		}
	}
	g.edges = g.edges.filter((e: GraphEdge): boolean => find(e.a) === best);
	const used: Set<number> = new Set(g.edges.flatMap((e: GraphEdge): number[] => [e.a, e.b]));
	for (const id of [...g.nodes.keys()]) if (!used.has(id)) g.nodes.delete(id);
}
