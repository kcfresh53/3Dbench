import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildIndex, segmentCurve } from '../../roadscape/src/core/network';
import { addNode, addSegment, createNetwork } from '../../roadscape/src/core/network';
import { counterIds, splitSegmentAt } from '../../roadscape/src/core/network_edit';
import type { RoadNetwork, RoadSegment } from '../../roadscape/src/core/model';
import type { Vec3 } from '../src/core/types';
import { roadSetFromNetwork } from '../src/core/roads/corridor';
import type { RoadCorridor } from '../src/core/roads/corridor';
import { exportRoads, simplifyCentreline } from '../src/core/roads/export';
import { DEFAULT_RAMP, makeRamp } from '../src/core/roads/ramp';
import type { RampOptions } from '../src/core/roads/ramp';

/** A straight highway running along +X from `a` to `b`, 300 m long. */
function highway(): RoadNetwork {
	const n: RoadNetwork = createNetwork({ defaultProfile: 'highway' });
	addNode(n, 'a', [0, 0, 0]);
	addNode(n, 'b', [300, 0, 0]);
	addSegment(n, 'a', 'b', { profile: 'highway' });
	return n;
}

const ramp = (over: Partial<RampOptions> = {}): RampOptions => ({ ...DEFAULT_RAMP, length: 90, ...over });

test('an exit ramp peels away ahead of the junction, tangent to the highway at first', () => {
	const network = highway();
	const result = makeRamp(network, 'a|b', 100, ramp({ kind: 'exit', side: 'right' }), counterIds('~r'));
	const junction = network.nodes.get(result.junction)!.position;
	const end = network.nodes.get(result.end)!.position;
	assert.ok(Math.abs(junction[0] - 100) < 1e-6 && Math.abs(junction[2]) < 1e-6, 'the junction sits on the highway at the chosen distance');
	assert.ok(end[0] > junction[0] + 40, 'an exit runs ahead of the junction');
	assert.ok(Math.abs(end[2]) > 15, 'and swings out from the highway');
	const index = buildIndex(network);
	const curve = segmentCurve(network, index, network.segments.get(result.segment) as RoadSegment);
	const away: Vec3 = curve.frameAt(0).forward;
	assert.ok(Math.abs(away[2]) < 0.2 && Math.abs(away[0]) > 0.97, 'it leaves along the highway');
	// The highway itself is still one connected road through the junction.
	assert.equal(result.highway.length, 2);
	for (const key of result.highway) assert.ok(network.segments.has(key));
});

test('an entry ramp arrives from behind and left and right ramps mirror each other', () => {
	const entry = highway();
	const e = makeRamp(entry, 'a|b', 200, ramp({ kind: 'entry', side: 'right' }), counterIds('~e'));
	assert.ok(entry.nodes.get(e.end)!.position[0] < entry.nodes.get(e.junction)!.position[0] - 40, 'an entry starts behind the junction');
	const right = highway();
	const left = highway();
	const r = makeRamp(right, 'a|b', 100, ramp({ side: 'right' }), counterIds('~r'));
	const l = makeRamp(left, 'a|b', 100, ramp({ side: 'left' }), counterIds('~l'));
	const rz = right.nodes.get(r.end)!.position[2];
	const lz = left.nodes.get(l.end)!.position[2];
	assert.ok(rz * lz < 0 && Math.abs(Math.abs(rz) - Math.abs(lz)) < 1e-6, 'sides are mirror images');
	const flipped = highway();
	const f = makeRamp(flipped, 'a|b', 100, ramp({ side: 'right', travel: 'backward' }), counterIds('~f'));
	assert.ok(flipped.nodes.get(f.end)!.position[0] < 100 && Math.sign(flipped.nodes.get(f.end)!.position[2]) === -Math.sign(rz), 'against the highway order, right is the other side');
});

test('ramps record which way traffic runs and the export lists points in that direction', () => {
	for (const kind of ['exit', 'entry'] as const) {
		const network = highway();
		const result = makeRamp(network, 'a|b', 120, ramp({ kind }), counterIds('~x'));
		const set = roadSetFromNetwork(network, { toCity: (p: Vec3): Vec3 => p, lengthScale: 1, sampleSpacing: 3, terrainHeight: (): number => 0 });
		const road: RoadCorridor = set.corridors.find((c: RoadCorridor): boolean => c.id === result.segment) as RoadCorridor;
		assert.equal(road.oneWay, true);
		const first = road.points[0];
		const last = road.points[road.points.length - 1];
		const j = network.nodes.get(result.junction)!.position;
		const toJunction = (p: { x: number; z: number }): number => Math.hypot(p.x - j[0], p.z - j[2]);
		if (kind === 'exit') assert.ok(toJunction(first) < toJunction(last), 'exit traffic starts at the highway');
		else assert.ok(toJunction(last) < toJunction(first), 'entry traffic ends at the highway');
		assert.equal(kind === 'exit' ? road.startNode : road.endNode, result.junction);
	}
});

test('splitting a one-way road keeps its direction on both halves', () => {
	const network = createNetwork({ defaultProfile: 'ramp' });
	// Ids chosen so the node order and the direction of travel disagree.
	addNode(network, 'z', [0, 0, 0]);
	addNode(network, 'b', [100, 0, 0]);
	const s = addSegment(network, 'z', 'b', { profile: 'ramp' });
	s.flow = s.a === 'z' ? 'forward' : 'reverse';
	const split = splitSegmentAt(network, s.key, 40, 'm');
	// Traffic runs from z (x = 0) towards b (x = 100), so each half must run towards larger x.
	for (const half of [split.first, split.second]) {
		const start = network.nodes.get(half.flow === 'forward' ? half.a : half.b)!.position[0];
		const end = network.nodes.get(half.flow === 'forward' ? half.b : half.a)!.position[0];
		assert.ok(start < end, `half ${half.key} still runs from low x to high x`);
	}
});

test('a ramp refuses to start at the very end of a road or on a missing road', () => {
	assert.throws(() => makeRamp(highway(), 'a|b', 1, ramp(), counterIds('~q')), /few metres/);
	assert.throws(() => makeRamp(highway(), 'x|y', 50, ramp(), counterIds('~q')), /no longer exists/);
});

test('exported roads are simplified, keep their shape and carry lane data', () => {
	const arc = Array.from({ length: 60 }, (_v, i) => ({ x: Math.cos(i / 30) * 100, y: 0, z: Math.sin(i / 30) * 100 }));
	const simple = simplifyCentreline(arc, 0.15);
	assert.ok(simple.length < arc.length / 2, `${simple.length} of ${arc.length} points kept`);
	assert.deepEqual([simple[0], simple[simple.length - 1]], [arc[0], arc[arc.length - 1]]);
	const network = highway();
	const set = roadSetFromNetwork(network, { toCity: (p: Vec3): Vec3 => p, lengthScale: 1, sampleSpacing: 3, terrainHeight: (): number => 0 });
	const out = exportRoads(set);
	assert.equal(out.roads.length, 1);
	assert.equal(out.roads[0].points.length, 2, 'a straight road needs two points');
	assert.equal(out.roads[0].lanes, 4);
	assert.equal(out.roads[0].oneWay, false);
	assert.ok(out.roads[0].width > 14);
});

test('the game package carries the road network when asked to', async () => {
	const { buildGamePackage } = await import('../src/core/gameready/package');
	const { composeCity } = await import('../src/core/city/compose');
	const { crossroadNetwork, flatCity, roadsOf } = await import('./helpers');
	const state = flatCity(7);
	const set = roadsOf(crossroadNetwork(), state);
	const plan = composeCity(state, set);
	const pkg = buildGamePackage(plan, state);
	assert.equal(pkg.manifest.roads?.length, 4);
	assert.equal(pkg.report.roads, 4);
	assert.ok((pkg.manifest.junctions ?? []).length >= 1);
	state.settings.export.roads = false;
	const without = buildGamePackage(plan, state);
	assert.equal(without.manifest.roads, undefined);
	assert.equal(without.report.roads, 0);
});
