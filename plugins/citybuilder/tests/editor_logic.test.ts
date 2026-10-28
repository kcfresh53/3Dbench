import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE_NS from 'three';
import { DEFAULT_BRUSH, newStroke, strokeTo } from '../src/core/terrain/brush';
import { CityHistory, editOf } from '../src/editor/history';
import { pickCity } from '../src/editor/picker';
import { flatCity } from './helpers';

interface UndoStub {
	history: unknown[];
	initEdit(a: unknown): void;
	finishEdit(label: string, a: unknown): void;
}

const g = globalThis as unknown as Record<string, unknown>;
g.THREE = THREE_NS;
g.Project = { uuid: 'project-1', saved: true };
const undo: UndoStub = { history: [], initEdit(): void {}, finishEdit(): void { this.history.push({}); } };
g.Undo = undo;

test('history stores only the changed span and undoes and redoes it exactly', () => {
	const state = flatCity(3);
	let applied = 0;
	const history = new CityHistory(() => state, () => { applied++; });
	const original = state.terrain.heights.slice();
	history.begin();
	strokeTo(state.terrain, 0, 0, { ...DEFAULT_BRUSH, radius: 20, strength: 1 }, newStroke());
	state.districts.paintBrush(30, 30, 12, 4);
	state.settings.development = 0.3;
	const edited = state.terrain.heights.slice();
	assert.ok(history.commit('Test edit'));
	const edit = editOf(undo.history[undo.history.length - 1]);
	assert.ok(edit);
	const heightSpan = edit.layers.find((l) => l.layer === 'heights');
	assert.ok(heightSpan && heightSpan.before.length < state.terrain.heights.length, 'only the touched span is stored');

	history.apply(edit, 'undo');
	assert.deepEqual(state.terrain.heights, original);
	assert.equal(state.districts.idAt(30, 30), 0);
	assert.equal(state.settings.development, 0.8);
	history.apply(edit, 'redo');
	assert.deepEqual(state.terrain.heights, edited);
	assert.equal(state.districts.idAt(30, 30), 4);
	assert.equal(state.settings.development, 0.3);
	assert.equal(applied, 2);
});

test('an edit that changes nothing is not recorded', () => {
	const state = flatCity(3);
	const history = new CityHistory(() => state, () => {});
	const before = undo.history.length;
	history.begin();
	assert.equal(history.commit('Nothing'), false);
	assert.equal(undo.history.length, before);
});

test('discard restores everything a cancelled stroke touched', () => {
	const state = flatCity(3);
	const history = new CityHistory(() => state, () => {});
	const original = state.terrain.heights.slice();
	history.begin();
	strokeTo(state.terrain, 0, 0, { ...DEFAULT_BRUSH, radius: 30, strength: 1 }, newStroke());
	history.discard();
	assert.deepEqual(state.terrain.heights, original);
});

test('pointer picking finds the ground under the cursor for any units-per-metre', () => {
	const state = flatCity(3);
	for (const unitsPerMeter of [1, 16]) {
		const camera = new THREE_NS.PerspectiveCamera(45, 2, 0.1, 100000);
		camera.position.set(0, 400 * unitsPerMeter, 300 * unitsPerMeter);
		camera.lookAt(0, 2 * unitsPerMeter, 0);
		camera.updateMatrixWorld(true);
		camera.updateProjectionMatrix();
		const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }) };
		const preview = { canvas, camera } as unknown as Preview;
		// The screen centre looks at the point of the flat ground (height 2 m) above the origin.
		const hit = pickCity(preview, { clientX: 400, clientY: 200 } as MouseEvent, state.terrain, unitsPerMeter, 0);
		assert.ok(hit);
		assert.ok(Math.abs(hit.x) < 0.01 && Math.abs(hit.z) < 0.01, `centre hit at ${hit.x}, ${hit.z}`);
		assert.ok(Math.abs(hit.y - 2) < 0.01);
		// A point right of centre lands on positive X.
		const right = pickCity(preview, { clientX: 600, clientY: 200 } as MouseEvent, state.terrain, unitsPerMeter, 0);
		assert.ok(right && right.x > 10);
	}
});
