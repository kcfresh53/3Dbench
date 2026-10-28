import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_BRUSH, newStroke, strokeTo } from '../src/core/terrain/brush';
import { Heightfield } from '../src/core/terrain/heightfield';
import { buildPatch } from '../src/core/terrain/mesh';
import { deserializeCity, serializeCity, rleDecode, rleEncode } from '../src/core/city/serialize';
import { flatCity } from './helpers';

test('raise brush lifts the ground under the cursor and leaves distant ground alone', () => {
	const hf: Heightfield = new Heightfield({ cols: 65, rows: 65, cellSize: 4 });
	strokeTo(hf, 0, 0, { ...DEFAULT_BRUSH, mode: 'raise', radius: 20, strength: 1 }, newStroke());
	assert.ok(hf.sample(0, 0) > 0.05);
	assert.equal(hf.sample(100, 100), 0);
});

test('lower brush is the opposite of raise', () => {
	const hf: Heightfield = new Heightfield({ cols: 65, rows: 65, cellSize: 4 });
	strokeTo(hf, 0, 0, { ...DEFAULT_BRUSH, mode: 'lower', radius: 20, strength: 1 }, newStroke());
	assert.ok(hf.sample(0, 0) < -0.05);
});

test('terrain patch triangles agree with Heightfield.sample', () => {
	const hf: Heightfield = new Heightfield({ cols: 33, rows: 33, cellSize: 5 });
	for (let i: number = 0; i < hf.heights.length; i++) hf.heights[i] = Math.sin(i * 0.37) * 3;
	const patch = buildPatch(hf, 0, 0, 32, 32);
	// Every triangle must face up and its plane must reproduce the sampled height at its centroid.
	for (let t: number = 0; t < patch.indices.length; t += 3) {
		const ids: number[] = [patch.indices[t], patch.indices[t + 1], patch.indices[t + 2]];
		const p: number[][] = ids.map((i: number): number[] => [patch.positions[i * 3], patch.positions[i * 3 + 1], patch.positions[i * 3 + 2]]);
		const ux: number = p[1][0] - p[0][0];
		const uz: number = p[1][2] - p[0][2];
		const vx: number = p[2][0] - p[0][0];
		const vz: number = p[2][2] - p[0][2];
		assert.ok(uz * vx - ux * vz > 0, 'triangle faces up');
		const cx: number = (p[0][0] + p[1][0] + p[2][0]) / 3;
		const cz: number = (p[0][2] + p[1][2] + p[2][2]) / 3;
		const cy: number = (p[0][1] + p[1][1] + p[2][1]) / 3;
		assert.ok(Math.abs(hf.sample(cx, cz) - cy) < 1e-3, 'sample matches mesh');
	}
});

test('run-length encoding round trips', () => {
	const data: Uint8Array = Uint8Array.from([...new Array(700).fill(3), 1, 2, 2, 9, ...new Array(300).fill(0)]);
	assert.deepEqual(rleDecode(rleEncode(data), data.length), data);
});

test('saved cities load back identically', () => {
	const state = flatCity(4);
	strokeTo(state.terrain, 10, 10, { ...DEFAULT_BRUSH, radius: 40, strength: 1 }, newStroke());
	state.districts.paintBrush(0, 0, 30, 2);
	state.paint.set(3, 4, 5);
	const loaded = deserializeCity(serializeCity(state));
	assert.ok(loaded);
	assert.equal(loaded.districts.idAt(0, 0), 2);
	assert.equal(loaded.paint.get(3, 4), 5);
	for (let i: number = 0; i < state.terrain.heights.length; i++) assert.ok(Math.abs(loaded.terrain.heights[i] - state.terrain.heights[i]) < 0.001);
});

test('unknown save versions are rejected', () => {
	assert.equal(deserializeCity('{"version":99}'), null);
	assert.equal(deserializeCity('not json'), null);
});
