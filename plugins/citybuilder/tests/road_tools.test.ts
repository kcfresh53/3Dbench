import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildIndex, classifyNode, segmentCurve } from '../../roadscape/src/core/network';
import { counterIds } from '../../roadscape/src/core/network_edit';
import type { RoadNetwork, RoadSegment } from '../../roadscape/src/core/model';
import { DEFAULT_ROAD_PAINT, paintRoadType } from '../src/core/roads/road_paint';
import type { RoadPaintOptions } from '../src/core/roads/road_paint';
import { DEFAULT_ROUNDABOUT, makeRoundabout } from '../src/core/roads/roundabout';
import { crossroadNetwork } from './helpers';

const PAINT: RoadPaintOptions = { toCity: (p) => p, metresPerUnit: 1, ...DEFAULT_ROAD_PAINT };

function totalLength(network: RoadNetwork): number {
	const index = buildIndex(network);
	let sum = 0;
	for (const s of network.segments.values()) sum += segmentCurve(network, index, s).length;
	return sum;
}

test('a roundabout replaces the junction with a ring of true arcs and keeps every road connected', () => {
	const network = crossroadNetwork(160);
	const result = makeRoundabout(network, 'c', { ...DEFAULT_ROUNDABOUT, radius: 18 }, counterIds('~r'));
	assert.equal(network.nodes.has('c'), false, 'the old junction point is gone');
	assert.ok(result.ring.length >= 8, 'four arms 90 degrees apart gain a midpoint per gap');
	assert.equal(result.segments.length, result.ring.length);
	const index = buildIndex(network);
	for (const id of result.ring) {
		const p = network.nodes.get(id)!.position;
		assert.ok(Math.abs(Math.hypot(p[0] - result.center[0], p[2] - result.center[2]) - 18) < 1e-6, 'ring points sit on the circle');
		assert.ok((index.incident.get(id) ?? []).length >= 2);
	}
	// Arm points become real junctions; their far ends are untouched.
	assert.equal(result.ring.filter((id) => classifyNode(network, index, id) === 'junction').length, 4);
	for (const far of ['n', 's', 'e', 'w']) assert.ok(network.nodes.has(far));
	// Every ring segment follows the circle: its length matches the arc it spans.
	let ringLength = 0;
	for (const key of result.segments) ringLength += segmentCurve(network, index, network.segments.get(key) as RoadSegment).length;
	assert.ok(Math.abs(ringLength - 2 * Math.PI * 18) / (2 * Math.PI * 18) < 0.01, `ring length ${ringLength}`);
	for (const key of result.segments) {
		const curve = segmentCurve(network, index, network.segments.get(key) as RoadSegment);
		for (const t of [0.25, 0.5, 0.75]) {
			const p = curve.pointAt(t);
			assert.ok(Math.abs(Math.hypot(p[0], p[2]) - 18) < 0.05, 'mid points stay on the circle');
		}
	}
	// Arms keep their road type, the ring forks a calmer copy of it.
	assert.equal(result.profile, 'street_ring');
	assert.equal(network.profiles.get('street_ring')?.carriageway.crosswalks, 'none');
});

test('roundabouts cope with one arm, odd angles, curved arms and refuse roads that are too short', () => {
	const single = crossroadNetwork(80);
	for (const id of ['s', 'e', 'w']) {
		for (const [key, s] of [...single.segments]) if (s.a === id || s.b === id) single.segments.delete(key);
		single.nodes.delete(id);
	}
	const turnaround = makeRoundabout(single, 'c', { ...DEFAULT_ROUNDABOUT, radius: 12 }, counterIds('~a'));
	assert.ok(turnaround.ring.length >= 5, 'a dead end still gets a closed ring');
	assert.throws(() => makeRoundabout(crossroadNetwork(20), 'c', { ...DEFAULT_ROUNDABOUT, radius: 18 }, counterIds('~b')), /too short/);
	const left = crossroadNetwork(120);
	const mirrored = makeRoundabout(left, 'c', { ...DEFAULT_ROUNDABOUT, radius: 15, hand: 'left' }, counterIds('~c'));
	assert.equal(mirrored.ring.length, mirrored.segments.length);
	const before = crossroadNetwork(120);
	assert.throws(() => makeRoundabout(before, 'nope', { ...DEFAULT_ROUNDABOUT, radius: 5 }, counterIds('~d')), /no longer exists/);
});

test('painting a road type cuts roads at the region edge and leaves the rest alone', () => {
	const network = crossroadNetwork(160);
	const before = totalLength(network);
	const region = (x: number): boolean => x >= 40 && x <= 100;
	const result = paintRoadType(network, (x, z) => region(x) && Math.abs(z) < 30, { structure: 'bridge', profile: 'bridge_road' }, counterIds('~p'), PAINT);
	assert.equal(result.changed, 1);
	assert.equal(result.split, 2);
	const bridges = [...network.segments.values()].filter((s) => s.structure === 'bridge');
	assert.equal(bridges.length, 1);
	assert.equal(bridges[0].profile, 'bridge_road');
	const index = buildIndex(network);
	const span = segmentCurve(network, index, bridges[0]);
	assert.ok(Math.abs(span.length - 60) < 0.3, `bridge is ${span.length} m`);
	const xs = [span.p0[0], span.p1[0]].sort((a, b) => a - b);
	assert.ok(Math.abs(xs[0] - 40) < 0.3 && Math.abs(xs[1] - 100) < 0.3);
	assert.ok(Math.abs(totalLength(network) - before) < 0.01, 'cutting keeps the road shape');
	assert.equal([...network.segments.values()].filter((s) => s.profile === 'street').length, 5);
	// Painting the same thing again changes nothing.
	const again = paintRoadType(network, (x, z) => region(x) && Math.abs(z) < 30, { structure: 'bridge', profile: 'bridge_road' }, counterIds('~q'), PAINT);
	assert.deepEqual(again, { changed: 0, split: 0 });
	assert.equal(network.segments.size, 6);
});

test('painting covers whole roads without cutting, drops slivers and can change only the structure', () => {
	const network = crossroadNetwork(160);
	const all = paintRoadType(network, () => true, { structure: 'tunnel' }, counterIds('~a'), PAINT);
	assert.deepEqual(all, { changed: 4, split: 0 });
	assert.ok([...network.segments.values()].every((s) => s.structure === 'tunnel' && s.profile === 'street'));
	const fresh = crossroadNetwork(160);
	const sliver = paintRoadType(fresh, (x, z) => x > 100 && x < 102 && Math.abs(z) < 5, { profile: 'race' }, counterIds('~b'), PAINT);
	assert.deepEqual(sliver, { changed: 0, split: 0 });
	const nearEnd = paintRoadType(fresh, (x, z) => x > 2 && Math.abs(z) < 5, { profile: 'race' }, counterIds('~c'), PAINT);
	assert.equal(nearEnd.split, 0, 'a stretch that starts within a few metres of the junction snaps to it');
	assert.equal([...fresh.segments.values()].filter((s) => s.profile === 'race').length, 1);
});
