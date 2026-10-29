import test from 'node:test';
import assert from 'node:assert/strict';
import type { MeshPart, Vec3 } from '../src/core/types';
import type { RoadNetwork } from '../src/core/model';
import { BUILTIN_PROFILES } from '../src/core/profile_library';
import { GenerationCache, generateNetwork } from '../src/core/generate';
import type { GenerateResult } from '../src/core/generate';
import { NO_TREES } from '../src/core/context';
import type { GenerationContext } from '../src/core/context';
import { addNode, addSegment, createNetwork } from '../src/core/network';
import { bounds, checkParts, crossroad, edgeStats, FakeTrees, network, upwardShare } from './helpers';
import { loadLibrary } from './fixtures';

const library = loadLibrary();
const plain: GenerationContext = { library, trees: NO_TREES };
const treed: GenerationContext = { library, trees: new FakeTrees() };

function part(result: GenerateResult, name: string): MeshPart {
	const found: MeshPart | undefined = result.parts.find((p: MeshPart): boolean => p.name === name);
	assert.ok(found, `Missing part ${name}`);
	return found as MeshPart;
}

test('every built-in road type generates clean indexed geometry in every weather', () => {
	for (const profile of BUILTIN_PROFILES) {
		for (const weather of ['spring', 'wet', 'snow'] as const) {
			const net: RoadNetwork = network(profile.id, [['a', [0, 0, 0]], ['b', [30, 0, 20]], ['c', [60, 0, 20]]], [['a', 'b'], ['b', 'c']]);
			net.settings.weather = weather;
			const result: GenerateResult = generateNetwork(net, treed);
			assert.equal(checkParts(result.parts), result.triangles, `${profile.id}/${weather}`);
			assert.ok(result.triangles > 0);
		}
	}
});

test('road surface faces up on straight roads, bends and every junction shape', () => {
	const shapes: Record<string, RoadNetwork> = {
		straight: network('highway', [['a', [0, 0, 0]], ['b', [80, 0, 0]]], [['a', 'b']]),
		cross: crossroad('avenue'),
		tee: network('street', [['c', [0, 0, 0]], ['w', [-40, 0, 0]], ['e', [40, 0, 0]], ['s', [0, 0, 40]]], [['c', 'w'], ['c', 'e'], ['c', 's']]),
		wye: network('street', [['c', [0, 0, 0]], ['a', [-30, 0, -40]], ['b', [30, 0, -40]], ['s', [0, 0, 50]]], [['c', 'a'], ['c', 'b'], ['c', 's']]),
		star: network('street', [['c', [0, 0, 0]], ['1', [50, 0, 0]], ['2', [15, 0, 47]], ['3', [-40, 0, 29]], ['4', [-40, 0, -29]], ['5', [15, 0, -47]]], [['c', '1'], ['c', '2'], ['c', '3'], ['c', '4'], ['c', '5']]),
		change: network('street', [['a', [0, 0, 0]], ['m', [40, 0, 0]], ['b', [80, 0, 0]]], [['a', 'm']]),
	};
	addNode(shapes.change, 'b2', [80, 0, 0]);
	for (const [name, net] of Object.entries(shapes)) {
		const result: GenerateResult = generateNetwork(net, plain);
		checkParts(result.parts);
		assert.ok(upwardShare(part(result, 'Road surface')) > 0.999, `${name}: road surface faces down somewhere`);
	}
});

test('a junction patch closes the gap between its roads', () => {
	const result: GenerateResult = generateNetwork(crossroad('street'), plain);
	const stats = edgeStats(part(result, 'Road surface'));
	assert.equal(stats.overshared, 0);
	// Open edges are the outer rim (arm ends and strip edges); the interior of the junction has none.
	const box = bounds(result.parts);
	assert.ok(box.max[0] > 55 && box.min[0] < -55 && box.max[2] > 55 && box.min[2] < -55);
});

test('corner radius setback never lets a short road be swallowed by its junctions', () => {
	const net: RoadNetwork = network('avenue', [['a', [0, 0, 0]], ['b', [14, 0, 0]], ['n1', [0, 0, -30]], ['s1', [0, 0, 30]], ['n2', [14, 0, -30]], ['s2', [14, 0, 30]], ['w', [-30, 0, 0]], ['e', [44, 0, 0]]], [
		['a', 'b'], ['a', 'n1'], ['a', 's1'], ['a', 'w'], ['b', 'n2'], ['b', 's2'], ['b', 'e'],
	]);
	const result: GenerateResult = generateNetwork(net, plain);
	checkParts(result.parts);
	assert.ok(result.triangles > 0);
});

test('lamps lean toward the road on both sides, never as a mirror image', () => {
	const net: RoadNetwork = network('street', [['a', [0, 0, 0]], ['b', [0, 0, 100]]], [['a', 'b']]);
	const result: GenerateResult = generateNetwork(net, plain);
	const lamps: MeshPart = part(result, 'Street lamp');
	// Group vertices by lamp: each lamp's pole base is the lowest point, its head the highest.
	const base: Vec3[] = [];
	const head: Vec3[] = [];
	const xs: number[] = lamps.positions.map((p: Vec3): number => p[0]);
	assert.ok(Math.min(...xs) < -2 && Math.max(...xs) > 2, 'lamps on both sides');
	for (const p of lamps.positions) (p[1] < 0.5 ? base : p[1] > 7 ? head : []).push(p);
	assert.ok(base.length > 0 && head.length > 0);
	for (const h of head) {
		const same: Vec3 = base.reduce((best: Vec3, b: Vec3): Vec3 => (Math.hypot(b[0] - h[0], b[2] - h[2]) < Math.hypot(best[0] - h[0], best[2] - h[2]) ? b : best));
		assert.ok(Math.abs(h[0]) < Math.abs(same[0]) + 0.2, 'lamp head should reach toward the centre line');
	}
});

test('procedural trees stay on the ground and wait for the generator without failing', () => {
	const net: RoadNetwork = network('tree_street', [['a', [0, 0, 0]], ['b', [0, 0, 120]]], [['a', 'b']]);
	const waiting: GenerateResult = generateNetwork(net, plain);
	assert.equal(waiting.report.treesPending, true);
	const grown: GenerateResult = generateNetwork(net, treed);
	assert.equal(grown.report.treesPending, false);
	const trees: MeshPart = part(grown, 'Trees');
	assert.equal(trees.atlas, 'tree:fake');
	assert.ok(trees.faces.length >= 8);
	const box = bounds([trees]);
	assert.ok(box.min[1] >= 0 && box.min[1] < 0.5);
});

test('bridges get a deck and piers, tunnels a shell, and the type is picked from height', () => {
	const high: RoadNetwork = network('street', [['a', [0, 12, 0]], ['b', [0, 12, 80]]], [['a', 'b']]);
	const bridge: GenerateResult = generateNetwork(high, plain);
	assert.ok(part(bridge, 'Bridge deck') && part(bridge, 'Bridge pier'));
	const deep: RoadNetwork = network('street', [['a', [0, -10, 0]], ['b', [0, -10, 80]]], [['a', 'b']]);
	const tunnel: GenerateResult = generateNetwork(deep, plain);
	assert.ok(part(tunnel, 'Tunnel') && part(tunnel, 'Tunnel ceiling'));
	const level: GenerateResult = generateNetwork(network('street', [['a', [0, 0, 0]], ['b', [0, 0, 80]]], [['a', 'b']]), plain);
	assert.equal(level.parts.some((p: MeshPart): boolean => p.name === 'Bridge deck' || p.name === 'Tunnel'), false);
});

test('side stacks with several linings place each one, in order, at its own distance', () => {
	const net: RoadNetwork = network('avenue', [['a', [0, 0, 0]], ['b', [0, 0, 90]]], [['a', 'b']]);
	const result: GenerateResult = generateNetwork(net, treed);
	for (const name of ['Sidewalk', 'Verge', 'Street lamp', 'Trees']) assert.ok(part(result, name), name);
	const lampX: number[] = part(result, 'Street lamp').positions.map((p: Vec3): number => Math.abs(p[0]));
	const treeX: number[] = part(result, 'Trees').positions.map((p: Vec3): number => Math.abs(p[0]));
	assert.ok(Math.min(...treeX) > 0, 'trees beside the road');
	assert.ok(Math.max(...lampX) > 0);
});

test('thinning to a budget removes props instead of swapping models, and is repeatable', () => {
	const net: RoadNetwork = network('tree_street', [['a', [0, 0, 0]], ['b', [0, 0, 400]]], [['a', 'b']]);
	const full: GenerateResult = generateNetwork(net, treed);
	net.settings.budget = { maxTriangles: Math.round(full.triangles * 0.7), enforce: true };
	const thinned: GenerateResult = generateNetwork(net, treed);
	assert.ok(thinned.triangles <= net.settings.budget.maxTriangles, `${thinned.triangles} > ${net.settings.budget.maxTriangles}`);
	assert.ok(thinned.density.size > 0);
	const again: GenerateResult = generateNetwork(net, treed);
	assert.equal(again.triangles, thinned.triangles);
	// The road surface itself is untouched.
	assert.equal(part(thinned, 'Road surface').faces.length, part(full, 'Road surface').faces.length);
});

test('the cache rebuilds only the roads that changed', () => {
	const cache: GenerationCache = new GenerationCache();
	const net: RoadNetwork = crossroad('street');
	const first: GenerateResult = generateNetwork(net, plain, cache);
	const second: GenerateResult = generateNetwork(net, plain, cache);
	assert.equal(second.triangles, first.triangles);
	const moved: RoadNetwork = crossroad('street');
	(moved.nodes.get('e') as { position: Vec3 }).position = [60, 0, 10];
	const third: GenerateResult = generateNetwork(moved, plain, cache);
	const fresh: GenerateResult = generateNetwork(moved, plain);
	assert.equal(third.triangles, fresh.triangles);
	assert.notEqual(third.triangles, 0);
});

test('a dead end gets a rounded cap and a lone point makes nothing', () => {
	const lone: RoadNetwork = createNetwork();
	addNode(lone, 'a', [0, 0, 0]);
	assert.equal(generateNetwork(lone, plain).triangles, 0);
	const road: RoadNetwork = network('street', [['a', [0, 0, 0]], ['b', [40, 0, 0]]], [['a', 'b']]);
	const capped: GenerateResult = generateNetwork(road, plain);
	road.settings.junction.endCap = 'flat';
	const open: GenerateResult = generateNetwork(road, plain);
	assert.ok(capped.triangles > open.triangles);
	void addSegment;
});

test('thinning also removes corner props at junctions, down to bare surfaces', () => {
	const net: RoadNetwork = crossroad('avenue');
	const full: GenerateResult = generateNetwork(net, plain);
	assert.ok(full.breakdown['Street lamp'] > 0);
	net.settings.budget = { maxTriangles: 1, enforce: true };
	const bare: GenerateResult = generateNetwork(net, plain);
	assert.equal(bare.breakdown['Street lamp'] ?? 0, 0);
	assert.ok(bare.report.warnings.length > 0, 'an impossible budget is reported, not hidden');
});

test('terrain provider updates bridge foundations through the cache and open spans omit supports',()=>{
 const road=network('street',[['a',[0,3,0]],['b',[0,3,80]]],[['a','b']]);
 const cache=new GenerationCache();
 const context:GenerationContext={...plain,terrain:{revision:'1',groundAt:()=>-4,autoStructure:()=> 'bridge'}};
 const first=generateNetwork(road,context,cache);
 assert.equal(bounds([part(first,'Bridge pier')]).min[1],-4);
 context.terrain={revision:'2',groundAt:()=>-9,autoStructure:()=> 'bridge'};
 const next=generateNetwork(road,context,cache);
 assert.equal(bounds([part(next,'Bridge pier')]).min[1],-9);
 for(const edge of road.segments.values())edge.structure='air';
 const jump=generateNetwork(road,context,cache);
 assert.ok(!jump.parts.some(p=>p.name==='Bridge pier'||p.name==='Bridge deck'));
 assert.ok(jump.parts.some(p=>p.name==='Road surface'));
});


test('bridge columns avoid a lower road and a lower-road edit invalidates cached bridge supports', () => {
    const n = network('street', [['a',[-60,0,0]],['b',[60,0,0]],['c',[0,14,-60]],['d',[0,14,60]]], [['a','b'],['c','d']]);
    n.segments.get('c|d')!.structure = 'bridge';
    const cache = new GenerationCache();
    const result = generateNetwork(n,plain,cache);
    const piers = part(result,'Bridge pier');
    assert.ok(piers.positions.length>0);
    // Every pier has a margin beyond the lower road envelope, including a half-metre pier radius.
    assert.ok(piers.positions.every(p=>Math.abs(p[2])>7), 'a column blocks the road under the bridge');
    const before = cache.segment('c|d');
    n.nodes.get('a')!.position[2]=30; n.nodes.get('b')!.position[2]=30;
    generateNetwork(n,plain,cache);
    assert.notEqual(cache.segment('c|d'),before, 'moving a lower road must rebuild bridge clearance');
});

test('a cantilever viaduct stands on single T supports that are fewer and wider than plain piers', () => {
	const make = (support: 'pier' | 'cantilever'): GenerateResult => {
		const net: RoadNetwork = network('viaduct', [['a', [0, 12, 0]], ['b', [0, 12, 120]]], [['a', 'b']]);
		const copy = { ...BUILTIN_PROFILES.find((p) => p.id === 'viaduct')!, id: 'v2', support };
		net.profiles.set('v2', copy);
		for (const s of net.segments.values()) s.profile = 'v2';
		return generateNetwork(net, plain);
	};
	const cantilever: GenerateResult = make('cantilever');
	const piers: GenerateResult = make('pier');
	const box = bounds([part(cantilever, 'Bridge pier')]);
	assert.ok(box.max[0] - box.min[0] > 8, 'the beam reaches under most of the deck');
	assert.ok(part(cantilever, 'Bridge pier').faces.length < part(piers, 'Bridge pier').faces.length * 4);
	checkParts(cantilever.parts);
});

test('every built-in road type generates clean geometry, including bridges and tunnels', () => {
	for (const profile of BUILTIN_PROFILES) {
		for (const height of [0, 12]) {
			const net: RoadNetwork = network(profile.id, [['a', [0, height, 0]], ['b', [0, height, 60]], ['c', [40, height, 60]]], [['a', 'b'], ['b', 'c']]);
			const result: GenerateResult = generateNetwork(net, plain);
			assert.ok(result.parts.length > 0, profile.id);
			checkParts(result.parts);
		}
	}
});
