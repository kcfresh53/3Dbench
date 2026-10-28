import test from 'node:test';
import assert from 'node:assert/strict';
import type { RoadNetwork } from '../src/core/model';
import { applyDraft, counterIds } from '../src/core/network_edit';
import type { DraftAnchor } from '../src/core/network_edit';
import { readNetwork, writeNetwork, selectedSegments } from '../src/editor/network_mesh';
import { documentFromNetwork } from '../src/editor/document';
import { network } from './helpers';
import { RoadSession } from '../src/editor/session';
import type { LiveRoads } from '../src/editor/live_manager';
import type { DrawTool } from '../src/editor/draw_tool';

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
	edges: Array<[string, string]> = [];
	getSelectedEdges(): Array<[string, string]> { return this.edges; }
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


test('explicit road edge selection does not edit other roads between selected points', () => {
 const mesh = new FakeMesh(); mesh.selected = ['a', 'b', 'c']; mesh.edges = [['b', 'c']];
 const net = network('street', [['a',[0,0,0]],['b',[20,0,0]],['c',[40,0,20]]], [['a','b'],['b','c'],['a','c']]);
 assert.deepEqual(selectedSegments(asMesh(mesh), net, 'edge').map(s=>[s.a,s.b]), [['b','c']]);
 assert.equal(selectedSegments(asMesh(mesh), net, 'vertex').length,3,'Old edge selection must not override vertex selection');
});

test('road type and custom draft changes immediately appear without editing an existing road', () => {
 const mesh = new FakeMesh(); const net = network('street', [['a',[0,0,0]],['b',[20,0,0]]], [['a','b']]);
 let edits = 0, refreshes = 0;
 const manager = { selected:()=>asMesh(mesh), networkOf:()=>net, states:new Map(), edit:()=>{edits++;} } as unknown as LiveRoads;
 const session = new RoadSession(manager);
 session.draw = { active:true, target:asMesh(mesh), pointCount:0, refresh:()=>{} } as unknown as DrawTool;
 session.changed = ()=>{refreshes++;};
 session.pickProfile('highway');
 assert.equal(session.snapshot(asMesh(mesh),undefined).profileId,'highway');
 session.editProfile(p=>({...p,carriageway:{...p.carriageway,laneWidth:4.25}}));
 const snap = session.snapshot(asMesh(mesh),undefined);
 assert.equal(snap.profile.carriageway.laneWidth,4.25);
 assert.equal(snap.profile.builtin,false);
 assert.equal(edits,0); assert.equal(refreshes,2);
 assert.equal([...net.segments.values()][0].profile,'street');
});

test('choosing a type with the whole network selected updates its default roads consistently', () => {
 const mesh = new FakeMesh(), net = network('street', [['a',[0,0,0]],['b',[20,0,0]]], [['a','b']]);
 const manager = { selected:()=>asMesh(mesh), networkOf:()=>net, states:new Map(), edit:(_mesh:unknown,_label:string,mutate:(net:RoadNetwork)=>void)=>mutate(net) } as unknown as LiveRoads;
 const session = new RoadSession(manager); session.pickProfile('highway');
 assert.equal(session.snapshot(asMesh(mesh),undefined).profileId,'highway');
 assert.equal([...net.segments.values()][0].profile,'highway');
 net.settings.defaultProfile='street';
 assert.equal(session.snapshot(asMesh(mesh),undefined).profileId,'highway','An unused default must not hide the type actually used');
 session.pickProfile('trail');
 assert.equal([...net.segments.values()][0].profile,'trail');
});
