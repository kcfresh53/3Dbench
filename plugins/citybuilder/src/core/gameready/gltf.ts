import type { MeshPart, Vec3 } from '../types';
import type { TerrainPatch } from '../terrain/mesh';

/** Textures a mesh uses, as paths relative to the .glb file. Missing maps fall back to plain factors. */
export interface GlbMaterial {
	baseColor: string;
	/** Occlusion (R), roughness (G), metallic (B): the packing glTF expects. */
	orm?: string;
	normal?: string;
	/** Alpha cutout, for foliage cards. */
	cutout?: number;
	doubleSided?: boolean;
	repeat?: boolean;
	roughness?: number;
}

interface Buffers {
	positions: number[];
	normals: number[];
	uvs: number[];
	indices: number[];
}

function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
	const ux: number = b[0] - a[0], uy: number = b[1] - a[1], uz: number = b[2] - a[2];
	const vx: number = c[0] - a[0], vy: number = c[1] - a[1], vz: number = c[2] - a[2];
	const x: number = uy * vz - uz * vy, y: number = uz * vx - ux * vz, z: number = ux * vy - uy * vx;
	const l: number = Math.hypot(x, y, z) || 1;
	return [x / l, y / l, z / l];
}

/** Polygons fanned into triangles. Corners that share position, UV and normal share a vertex. */
function fromPart(part: MeshPart): Buffers {
	const out: Buffers = { positions: [], normals: [], uvs: [], indices: [] };
	const lookup: Map<string, number> = new Map<string, number>();
	for (const face of part.faces) {
		if (face.indices.length < 3) continue;
		const flat: Vec3 = faceNormal(part.positions[face.indices[0]], part.positions[face.indices[1]], part.positions[face.indices[2]]);
		const ids: number[] = face.indices.map((vi: number, k: number): number => {
			const p: Vec3 = part.positions[vi];
			const n: Vec3 = face.normals?.[k] ?? flat;
			const uv: [number, number] = face.uvs[k];
			const key: string = `${vi}|${uv[0]}|${uv[1]}|${n[0]}|${n[1]}|${n[2]}`;
			let id: number | undefined = lookup.get(key);
			if (id === undefined) {
				id = out.positions.length / 3;
				lookup.set(key, id);
				out.positions.push(p[0], p[1], p[2]);
				out.normals.push(n[0], n[1], n[2]);
				out.uvs.push(uv[0], uv[1]);
			}
			return id;
		});
		for (let k: number = 1; k < ids.length - 1; k++) out.indices.push(ids[0], ids[k], ids[k + 1]);
	}
	return out;
}

function fromPatch(patch: TerrainPatch): Buffers {
	return { positions: Array.from(patch.positions), normals: Array.from(patch.normals), uvs: Array.from(patch.uvs), indices: Array.from(patch.indices) };
}

function pad4(n: number): number {
	return (n + 3) & ~3;
}

function encode(name: string, data: Buffers, material: GlbMaterial): Uint8Array {
	const vertices: number = data.positions.length / 3;
	const min: number[] = [Infinity, Infinity, Infinity];
	const max: number[] = [-Infinity, -Infinity, -Infinity];
	for (let i: number = 0; i < data.positions.length; i++) {
		min[i % 3] = Math.min(min[i % 3], data.positions[i]);
		max[i % 3] = Math.max(max[i % 3], data.positions[i]);
	}
	const sizes: number[] = [data.positions.length * 4, data.normals.length * 4, data.uvs.length * 4, data.indices.length * 4];
	const binLength: number = sizes.reduce((a: number, b: number): number => a + b, 0);
	const bin: ArrayBuffer = new ArrayBuffer(binLength);
	let offset: number = 0;
	new Float32Array(bin, offset, data.positions.length).set(data.positions);
	offset += sizes[0];
	new Float32Array(bin, offset, data.normals.length).set(data.normals);
	offset += sizes[1];
	new Float32Array(bin, offset, data.uvs.length).set(data.uvs);
	offset += sizes[2];
	new Uint32Array(bin, offset, data.indices.length).set(data.indices);

	const images: Array<{ uri: string }> = [{ uri: material.baseColor }];
	const pbr: Record<string, unknown> = { baseColorTexture: { index: 0 }, metallicFactor: 1, roughnessFactor: material.roughness ?? 1 };
	const mat: Record<string, unknown> = { name, pbrMetallicRoughness: pbr, doubleSided: material.doubleSided ?? false };
	if (material.orm) {
		images.push({ uri: material.orm });
		pbr.metallicRoughnessTexture = { index: images.length - 1 };
		mat.occlusionTexture = { index: images.length - 1 };
	} else {
		pbr.metallicFactor = 0;
		pbr.roughnessFactor = 0.9;
	}
	if (material.normal) {
		images.push({ uri: material.normal });
		mat.normalTexture = { index: images.length - 1 };
	}
	if (material.cutout !== undefined) {
		mat.alphaMode = 'MASK';
		mat.alphaCutoff = material.cutout;
	}
	const json = {
		asset: { version: '2.0', generator: 'CityBuilder' },
		scene: 0,
		scenes: [{ nodes: [0] }],
		nodes: [{ name, mesh: 0 }],
		meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0, mode: 4 }] }],
		materials: [mat],
		textures: images.map((_: { uri: string }, i: number): { source: number; sampler: number } => ({ source: i, sampler: 0 })),
		samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: material.repeat ? 10497 : 33071, wrapT: material.repeat ? 10497 : 33071 }],
		images,
		accessors: [
			{ bufferView: 0, componentType: 5126, count: vertices, type: 'VEC3', min, max },
			{ bufferView: 1, componentType: 5126, count: vertices, type: 'VEC3' },
			{ bufferView: 2, componentType: 5126, count: vertices, type: 'VEC2' },
			{ bufferView: 3, componentType: 5125, count: data.indices.length, type: 'SCALAR' },
		],
		bufferViews: [
			{ buffer: 0, byteOffset: 0, byteLength: sizes[0], target: 34962 },
			{ buffer: 0, byteOffset: sizes[0], byteLength: sizes[1], target: 34962 },
			{ buffer: 0, byteOffset: sizes[0] + sizes[1], byteLength: sizes[2], target: 34962 },
			{ buffer: 0, byteOffset: sizes[0] + sizes[1] + sizes[2], byteLength: sizes[3], target: 34963 },
		],
		buffers: [{ byteLength: binLength }],
	};
	const jsonBytes: Uint8Array = new TextEncoder().encode(JSON.stringify(json));
	const jsonLength: number = pad4(jsonBytes.length);
	const total: number = 12 + 8 + jsonLength + 8 + binLength;
	const glb: Uint8Array = new Uint8Array(total);
	const view: DataView = new DataView(glb.buffer);
	view.setUint32(0, 0x46546c67, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, total, true);
	view.setUint32(12, jsonLength, true);
	view.setUint32(16, 0x4e4f534a, true);
	glb.fill(0x20, 20 + jsonBytes.length, 20 + jsonLength);
	glb.set(jsonBytes, 20);
	view.setUint32(20 + jsonLength, binLength, true);
	view.setUint32(24 + jsonLength, 0x004e4942, true);
	glb.set(new Uint8Array(bin), 28 + jsonLength);
	return glb;
}

/** Binary glTF for one mesh part. UVs follow glTF: v runs down the image, as in the exported pages. */
export function partToGlb(part: MeshPart, name: string, material: GlbMaterial): Uint8Array {
	return encode(name, fromPart(part), material);
}

/** Binary glTF for a terrain patch, with the planar UVs the albedo texture expects. */
export function patchToGlb(patch: TerrainPatch, name: string, material: GlbMaterial): Uint8Array {
	return encode(name, fromPatch(patch), material);
}
