import type { MeshPart } from '../types';
import type { TerrainPatch } from '../terrain/mesh';

function f(n: number): string {
	return (Math.round(n * 10000) / 10000).toString();
}

/** Wavefront OBJ text for one part. Texture V is flipped because OBJ measures it from the bottom. */
export function partToObj(part: MeshPart, name: string): string {
	const lines: string[] = [`# CityBuilder`, `o ${name}`];
	for (const p of part.positions) lines.push(`v ${f(p[0])} ${f(p[1])} ${f(p[2])}`);
	let vt: number = 1;
	const faces: string[] = [];
	for (const face of part.faces) {
		const corners: string[] = [];
		face.indices.forEach((vi: number, k: number): void => {
			lines.push(`vt ${f(face.uvs[k][0])} ${f(1 - face.uvs[k][1])}`);
			corners.push(`${vi + 1}/${vt++}`);
		});
		faces.push(`f ${corners.join(' ')}`);
	}
	return [...lines, ...faces, ''].join('\n');
}

/** OBJ for a terrain patch, with normals and the planar UVs the albedo texture expects. */
export function patchToObj(patch: TerrainPatch, name: string): string {
	const lines: string[] = [`# CityBuilder terrain`, `o ${name}`];
	const n: number = patch.positions.length / 3;
	for (let i: number = 0; i < n; i++) lines.push(`v ${f(patch.positions[i * 3])} ${f(patch.positions[i * 3 + 1])} ${f(patch.positions[i * 3 + 2])}`);
	for (let i: number = 0; i < n; i++) lines.push(`vt ${f(patch.uvs[i * 2])} ${f(1 - patch.uvs[i * 2 + 1])}`);
	for (let i: number = 0; i < n; i++) lines.push(`vn ${f(patch.normals[i * 3])} ${f(patch.normals[i * 3 + 1])} ${f(patch.normals[i * 3 + 2])}`);
	for (let t: number = 0; t < patch.indices.length; t += 3) {
		const a: number = patch.indices[t] + 1;
		const b: number = patch.indices[t + 1] + 1;
		const c: number = patch.indices[t + 2] + 1;
		lines.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
	}
	lines.push('');
	return lines.join('\n');
}
