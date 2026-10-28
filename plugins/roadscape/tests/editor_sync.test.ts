import test from 'node:test';
import assert from 'node:assert/strict';
import type { RoadNetwork } from '../src/core/model';
import { applyDraft, counterIds } from '../src/core/network_edit';
import type { DraftAnchor } from '../src/core/network_edit';
import { readNetwork, writeNetwork } from '../src/editor/network_mesh';
import { documentFromNetwork } from '../src/editor/document';
import { network } from './helpers';

/** Just enough of Blockbench's Mesh for the sync code. */
class FakeFace {
	vertices: string[];
	constructor(_mesh: unknown, data: { vertices: string[] }) {
		this.vertices = data.vertices;
	}
}

class FakeMesh {
	vertices: Record<string, [number, number, number]> = {};
	faces: Record<string, FakeFace> = {};
	selected: string[] = [];
	private counter: number = 0;
	addVertices(...points: Array<[number, number, number]>): string[] {
		return points.map((p): string => {
			const key: string = `v${++this.counter}`;
			this.vertices[key] = p;
			return key;
		});
	}
	addFaces(...faces: FakeFace[]): string[] {
		return faces.map((f): string => {
			const key: string = `f${++this.counter}`;
			this.faces[key] = f;
			return key;
		});
	}
	getSelectedVertices(): string[] {
		return this.selected;
	}
}

(globalThis as unknown as Record<string, unknown>).MeshFace = FakeFace;

function asMesh(mesh: FakeMesh): Mesh {
	return mesh as unknown as Mesh;
}

test('a drawn network survives a trip into the control mesh and back', () => {
	const mesh: FakeMesh = new FakeMesh();
	const anchors: DraftAnchor[] = [[0, 0, 0], [30, 0, 10], [60, 0, 0]].map((p): DraftAnchor => ({ position: p as [number, number, number], snap: { type: 'free' } }));
	const drawn: RoadNetwork = applyDraft(network('avenue', [], []), anchors, counterIds(), { profile: 'avenue' }).network;
	const written = writeNetwork(asMesh(mesh), drawn);
	assert.equal(Object.keys(mesh.vertices).length, 3);
	assert.equal(Object.values(mesh.faces).length, 2);
	assert.ok(Object.keys(written.doc.segments).every((key: string): boolean => key.split('|').every((id: string): boolean => id in mesh.vertices)));
	const back: RoadNetwork = readNetwork(asMesh(mesh), written.doc);
	assert.equal(back.nodes.size, 3);
	assert.equal(back.segments.size, 2);
	for (const s of back.segments.values()) assert.equal(s.profile, 'avenue');
});

test('edges added by native extrusion take the road type of their neighbour', () => {
	const mesh: FakeMesh = new FakeMesh();
	const drawn: RoadNetwork = network('highway', [['a', [0, 0, 0]], ['b', [50, 0, 0]]], [['a', 'b']]);
	const written = writeNetwork(asMesh(mesh), drawn);
	const [keyA, keyB] = Object.keys(mesh.vertices);
	const [extra] = mesh.addVertices([100, 0, 0]);
	mesh.addFaces(new FakeFace(mesh, { vertices: [keyB, extra] }));
	const back: RoadNetwork = readNetwork(asMesh(mesh), written.doc);
	assert.equal(back.segments.size, 2);
	for (const s of back.segments.values()) assert.equal(s.profile, 'highway');
	void keyA;
});

test('deleting a point removes its roads and stale selection', () => {
	const mesh: FakeMesh = new FakeMesh();
	const net: RoadNetwork = network('street', [['a', [0, 0, 0]], ['b', [50, 0, 0]], ['c', [100, 0, 0]]], [['a', 'b'], ['b', 'c']]);
	let written = writeNetwork(asMesh(mesh), net);
	const doomed: string = Object.keys(mesh.vertices)[2];
	mesh.selected = [doomed];
	const back: RoadNetwork = readNetwork(asMesh(mesh), written.doc);
	back.nodes.delete(doomed);
	for (const key of [...back.segments.keys()]) if (key.includes(doomed)) back.segments.delete(key);
	written = writeNetwork(asMesh(mesh), back);
	assert.equal(Object.keys(mesh.vertices).length, 2);
	assert.equal(Object.values(mesh.faces).length, 1);
	assert.deepEqual(mesh.selected, []);
	assert.equal(Object.keys(documentFromNetwork(back).segments).length, 1);
});
