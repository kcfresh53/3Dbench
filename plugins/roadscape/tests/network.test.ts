import test from 'node:test';
import assert from 'node:assert/strict';
import type { RoadNetwork, RoadSegment } from '../src/core/model';
import { buildIndex, classifyNode, segmentCurve } from '../src/core/network';
import { applyDraft, autoIntersect, counterIds, insertPoint, joinNetworks, removePoint, snapPoint } from '../src/core/network_edit';
import type { DraftAnchor } from '../src/core/network_edit';
import { RoadCurve } from '../src/core/curve';
import { network } from './helpers';

function degrees(net: RoadNetwork): number[] {
	const index = buildIndex(net);
	return [...net.nodes.keys()].map((id: string): number => index.incident.get(id)?.length ?? 0).sort();
}

test('crossing roads become one four-way junction', () => {
	const net: RoadNetwork = network('street', [['a', [-50, 0, 0]], ['b', [50, 0, 0]], ['c', [0, 0, -50]], ['d', [0, 0, 50]]], [['a', 'b'], ['c', 'd']]);
	const { created } = autoIntersect(net, counterIds());
	assert.equal(created.length, 1);
	assert.equal(net.nodes.size, 5);
	assert.equal(net.segments.size, 4);
	assert.deepEqual(degrees(net), [1, 1, 1, 1, 4]);
	const centre = net.nodes.get(created[0]);
	assert.ok(centre && Math.hypot(centre.position[0], centre.position[2]) < 0.01);
	assert.equal(classifyNode(net, buildIndex(net), created[0]), 'junction');
});

test('a road ending on another road joins it with a T', () => {
	const net: RoadNetwork = network('street', [['a', [-50, 0, 0]], ['b', [50, 0, 0]], ['c', [0, 0, 40]], ['d', [0, 0, 0.5]]], [['a', 'b'], ['c', 'd']]);
	autoIntersect(net, counterIds());
	assert.deepEqual(degrees(net), [1, 1, 1, 3]);
});

test('roads passing over each other with clearance stay separate', () => {
	const net: RoadNetwork = network('street', [['a', [-50, 0, 0]], ['b', [50, 0, 0]], ['c', [0, 15, -50]], ['d', [0, 15, 50]]], [['a', 'b'], ['c', 'd']]);
	assert.equal(autoIntersect(net, counterIds()).created.length, 0);
	assert.equal(net.segments.size, 2);
});

test('splitting a curved road keeps its exact shape', () => {
	const net: RoadNetwork = network('street', [['a', [0, 0, 0]], ['b', [40, 0, 30]], ['c', [90, 0, 30]]], [['a', 'b'], ['b', 'c']]);
	const before: RoadCurve = segmentCurve(net, buildIndex(net), net.segments.get('a|b') as RoadSegment);
	const mid: [number, number, number] = before.pointAt(0.5);
	insertPoint(net, 'a|b', '~m');
	const node = net.nodes.get('~m');
	assert.ok(node);
	assert.ok(Math.hypot(node.position[0] - mid[0], node.position[2] - mid[2]) < 1.5);
	const first: RoadCurve = segmentCurve(net, buildIndex(net), net.segments.get('a|~m') as RoadSegment);
	assert.ok(Math.abs(first.pointAt(0.5)[0] - before.pointAt(0.25)[0]) < 1.5);
});

test('drawing across and onto roads snaps, splits and connects like a city builder', () => {
	const net: RoadNetwork = network('street', [['a', [-60, 0, 0]], ['b', [60, 0, 0]]], [['a', 'b']]);
	const anchors: DraftAnchor[] = [
		{ position: [0, 0, 0.2], snap: snapPoint(net, [0, 0, 0.2], 2).snap },
		{ position: [0, 0, 50], snap: { type: 'free' } },
	];
	assert.equal(anchors[0].snap.type, 'segment');
	const result = applyDraft(net, anchors, counterIds(), { profile: 'avenue' }, false, 2);
	assert.equal(result.network.segments.size, 3);
	assert.deepEqual(degrees(result.network), [1, 1, 1, 3]);
	assert.equal(net.segments.size, 1, 'original network untouched');
	// A drawn road that crosses an existing one gets a junction without any click on it.
	const across = applyDraft(net, [{ position: [20, 0, -40], snap: { type: 'free' } }, { position: [20, 0, 40], snap: { type: 'free' } }], counterIds(), {}, false, 2);
	assert.deepEqual(degrees(across.network), [1, 1, 1, 1, 4]);
});

test('closed loops, removing and joining points', () => {
	const net: RoadNetwork = network('street', [], []);
	const loop = applyDraft(net, [[0, 0, 0], [40, 0, 0], [40, 0, 40], [0, 0, 40]].map((p): DraftAnchor => ({ position: p as [number, number, number], snap: { type: 'free' } })), counterIds(), {}, true, 1);
	assert.equal(loop.network.segments.size, 4);
	assert.deepEqual(degrees(loop.network), [2, 2, 2, 2]);
	const id: string = [...loop.network.nodes.keys()][1];
	removePoint(loop.network, id);
	assert.equal(loop.network.segments.size, 3);
	assert.equal(loop.network.nodes.size, 3);
	const other: RoadNetwork = network('street', [['x', [100, 0, 0]], ['y', [100, 0, 40]]], [['x', 'y']]);
	assert.equal(joinNetworks(loop.network, other, counterIds('~j')).length, 1);
	assert.equal(loop.network.segments.size, 4);
});
