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

import { addNode, addSegment, createNetwork } from '../../roadscape/src/core/network';
import { elevationChain, setRoadElevation } from '../src/core/roads/elevation';
import { SupportClearance } from '../../roadscape/src/core/support_clearance';

test('eased elevation preserves horizontal curves across reversed segment keys', () => {
    const n = createNetwork();
    addNode(n, 'a', [0, 0, 0]); addNode(n, 'z', [50, 0, 10]); addNode(n, 'b', [100, 0, 0]);
    addSegment(n, 'a', 'z'); addSegment(n, 'z', 'b');
    const keys = [...n.segments.keys()];
    const before = [...n.segments.values()].map(s => segmentCurve(n, buildIndex(n), s));
    const path = setRoadElevation(n, keys, {start: 2, end: 22, easing:'smooth', structure:'bridge'});
    assert.deepEqual(path, ['a','z','b']);
    assert.equal(n.nodes.get('a')!.position[1], 2);
    assert.equal(n.nodes.get('b')!.position[1], 22);
    assert.ok(Math.abs(n.nodes.get('z')!.position[1]-12) < 1e-6);
    [...n.segments.values()].forEach((s,i) => {
        const c = segmentCurve(n, buildIndex(n), s);
        for (const t of [0,.25,.5,.75,1]) {
            assert.ok(Math.abs(c.pointAt(t)[0]-before[i].pointAt(t)[0]) < 1e-8);
            assert.ok(Math.abs(c.pointAt(t)[2]-before[i].pointAt(t)[2]) < 1e-8);
        }
        assert.equal(s.structure,'bridge');
    });
    const first = segmentCurve(n,buildIndex(n),n.segments.get('a|z')!);
    const last = segmentCurve(n,buildIndex(n),n.segments.get('b|z')!);
    assert.ok(Math.abs(first.derivativeAt(0)[1]) < 1e-8);
    assert.ok(Math.abs(last.derivativeAt(0)[1]) < 1e-8);
    setRoadElevation(n, keys, {start:22,end:2,easing:'linear',structure:'air'});
    assert.equal(n.nodes.get('a')!.position[1],22);
    assert.equal(n.nodes.get('b')!.position[1],2);
    assert.ok([...n.segments.values()].every(s => s.structure==='air'));
});

test('elevation rejects branched, disconnected and looped selections', () => {
    const n = crossroadNetwork(100);
    assert.throws(() => elevationChain(n,[...n.segments.keys()]),/branches/);
    assert.throws(() => elevationChain(n,[]),/Select/);
    assert.throws(() => setRoadElevation(n,[...n.segments.keys()],{start:NaN,end:0,easing:'linear',structure:'bridge'}),/finite/);
    const loop = createNetwork();
    for (const [id,p] of [['a',[0,0,0]],['b',[10,0,0]],['c',[10,0,10]]] as const) addNode(loop,id,[...p]);
    addSegment(loop,'a','b'); addSegment(loop,'b','c'); addSegment(loop,'c','a');
    assert.throws(() => elevationChain(loop,[...loop.segments.keys()]),/loops/);
});

test('painting retains automatic bridge classification outside the painted region', () => {
    const n = createNetwork(); addNode(n,'a',[0,8,0]); addNode(n,'b',[100,8,0]);
    addSegment(n,'a','b',{structure:'auto'});
    const result = paintRoadType(n,(x)=>x>40&&x<60,{profile:'race'},counterIds('~paint'),{...PAINT,resolveStructure:()=> 'bridge'});
    assert.equal(result.split,2);
    assert.ok([...n.segments.values()].every(s => s.structure==='bridge'), 'shortened approaches must not become terrain-filling ground roads');
    assert.equal([...n.segments.values()].filter(s=>s.profile==='race').length,1);
});

test('support clearance protects lower roads, permits clear ground, and refreshes after road edits', () => {
    const n = createNetwork();
    addNode(n,'a',[-50,0,0]); addNode(n,'b',[50,0,0]); addSegment(n,'a','b');
    addNode(n,'c',[0,12,-50]); addNode(n,'d',[0,12,50]); addSegment(n,'c','d',{structure:'bridge'});
    const index = new SupportClearance(n);
    assert.equal(index.allows('c|d',[0,12,0],0,11.4,.6),false);
    assert.equal(index.allows('c|d',[0,12,25],0,11.4,.6),true);
    assert.equal(index.allows('c|d',[0,12,0],2,11.4,.6),true,'a road below the foundation does not block the column');
    n.nodes.get('b')!.position[1] = 4;
    assert.notEqual(new SupportClearance(n).revision,index.revision);
});
