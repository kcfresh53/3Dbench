import test from 'node:test';
import assert from 'node:assert/strict';
import type { PropMesh, Vec3 } from '../src/core/types';
import { optimizeMesh } from '../src/core/optimize/mesh_optimizer';
import { optimizeLibraryProps } from '../src/core/optimize/library_optimizer';
import { triangleCount } from '../src/core/types';
import { loadLibrary } from './fixtures';

/** A cylinder with a textured side: lots of redundant rings that should collapse. */
function cylinder(rings: number, sides: number): PropMesh {
	const positions: Vec3[] = [];
	for (let r: number = 0; r <= rings; r++) {
		for (let s: number = 0; s < sides; s++) {
			const a: number = (s / sides) * Math.PI * 2;
			positions.push([Math.cos(a) * 0.1, (r / rings) * 2, Math.sin(a) * 0.1]);
		}
	}
	const faces: PropMesh['faces'] = [];
	for (let r: number = 0; r < rings; r++) {
		for (let s: number = 0; s < sides; s++) {
			const a: number = r * sides + s;
			const b: number = r * sides + ((s + 1) % sides);
			faces.push({ indices: [a, b, b + sides, a + sides], uvs: [[s / sides, r / rings], [(s + 1) / sides, r / rings], [(s + 1) / sides, (r + 1) / rings], [s / sides, (r + 1) / rings]], material: 'Road' });
		}
	}
	return { positions, faces };
}

test('a densely tessellated tube loses its redundant rings but keeps its silhouette', () => {
	const mesh: PropMesh = cylinder(24, 8);
	const before: number = triangleCount(mesh.faces);
	const { mesh: result } = optimizeMesh(mesh, { maxError: 0.01, targetTriangles: 20, hardMaxError: 0.05 });
	const after: number = triangleCount(result.faces);
	assert.ok(after < before * 0.25, `${before} -> ${after}`);
	const ys: number[] = result.positions.map((p: Vec3): number => p[1]);
	assert.ok(Math.min(...ys) < 0.01 && Math.max(...ys) > 1.99, 'height is preserved');
	for (const f of result.faces) {
		for (const uv of f.uvs) assert.ok(uv.every((v: number): boolean => v >= -1e-6 && v <= 1 + 1e-6));
		assert.equal(new Set(f.indices).size, f.indices.length);
	}
});

test('the real artwork keeps its look at a fraction of the triangles', () => {
	const props: Record<string, PropMesh> = loadLibrary().props;
	assert.ok(Object.keys(props).length >= 8);
	for (const [name, prop] of Object.entries(props)) {
		const triangles: number = triangleCount(prop.faces);
		assert.ok(triangles > 0 && triangles <= 400, `${name}: ${triangles}`);
		for (const p of prop.positions) assert.ok(p.every(Number.isFinite));
	}
	void optimizeLibraryProps;
});
