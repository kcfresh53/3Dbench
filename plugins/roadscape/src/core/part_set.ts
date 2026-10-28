import type { MeshPart, PartFace, Vec2, Vec3 } from './types';
import { cross, dot, sub } from './vec';

/** Collects geometry into named parts. Parts with the same name and atlas share one buffer. */
export class PartSet {
	private readonly parts: Map<string, MeshPart> = new Map();
	triangles: number = 0;

	part(name: string, atlas: string): MeshPart {
		const key: string = `${atlas}\u0000${name}`;
		let part: MeshPart | undefined = this.parts.get(key);
		if (!part) {
			part = { name, atlas, positions: [], faces: [] };
			this.parts.set(key, part);
		}
		return part;
	}

	vertex(part: MeshPart, position: Vec3): number {
		part.positions.push(position);
		return part.positions.length - 1;
	}

	face(part: MeshPart, indices: number[], uvs: Vec2[]): void {
		part.faces.push({ indices, uvs });
		this.triangles += indices.length - 2;
	}

	/**
	 * Adds a quad (or triangle) from positions, flipping its winding so that the surface normal
	 * points towards `facing`. UVs follow the corners.
	 */
	polygon(part: MeshPart, corners: Vec3[], uvs: Vec2[], facing: Vec3): void {
		const normal: Vec3 = polygonNormal(corners);
		const flip: boolean = dot(normal, facing) < 0;
		const order: number[] = corners.map((_: Vec3, i: number): number => (flip ? corners.length - 1 - i : i));
		const indices: number[] = order.map((i: number): number => this.vertex(part, corners[i]));
		this.face(part, indices, order.map((i: number): Vec2 => uvs[i]));
	}

	/** Appends an already-built face list (for instanced props). Returns the vertex base index. */
	append(part: MeshPart, positions: Vec3[], faces: PartFace[]): void {
		const base: number = part.positions.length;
		for (const p of positions) part.positions.push(p);
		for (const f of faces) this.face(part, f.indices.map((i: number): number => i + base), f.uvs);
	}

	all(): MeshPart[] {
		return [...this.parts.values()].filter((p: MeshPart): boolean => p.faces.length > 0);
	}
}

export function polygonNormal(corners: Vec3[]): Vec3 {
	// Newell's method: stable for slightly non-planar quads.
	let x: number = 0;
	let y: number = 0;
	let z: number = 0;
	for (let i: number = 0; i < corners.length; i++) {
		const a: Vec3 = corners[i];
		const b: Vec3 = corners[(i + 1) % corners.length];
		x += (a[1] - b[1]) * (a[2] + b[2]);
		y += (a[2] - b[2]) * (a[0] + b[0]);
		z += (a[0] - b[0]) * (a[1] + b[1]);
	}
	return [x, y, z];
}

export function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
	return cross(sub(b, a), sub(c, a));
}

/** Merges parts of identical name and atlas and welds coincident vertices. */
export function mergeParts(parts: MeshPart[]): MeshPart[] {
	const merged: Map<string, MeshPart> = new Map();
	for (const part of parts) {
		const key: string = `${part.atlas}\u0000${part.name}`;
		let target: MeshPart | undefined = merged.get(key);
		if (!target) {
			target = { name: part.name, atlas: part.atlas, positions: [], faces: [] };
			merged.set(key, target);
		}
		const base: number = target.positions.length;
		for (const p of part.positions) target.positions.push(p);
		for (const f of part.faces) target.faces.push({ indices: f.indices.map((i: number): number => i + base), uvs: f.uvs });
	}
	return [...merged.values()].map(weldPositions);
}

const QUANT: number = 1e4;

/** Welds vertices closer than 0.1 mm and drops faces that collapse. */
export function weldPositions(part: MeshPart): MeshPart {
	const lookup: Map<string, number> = new Map();
	const positions: Vec3[] = [];
	const remap: number[] = part.positions.map((p: Vec3): number => {
		const key: string = `${Math.round(p[0] * QUANT)},${Math.round(p[1] * QUANT)},${Math.round(p[2] * QUANT)}`;
		let index: number | undefined = lookup.get(key);
		if (index === undefined) {
			index = positions.length;
			positions.push(p);
			lookup.set(key, index);
		}
		return index;
	});
	const faces: PartFace[] = [];
	for (const f of part.faces) {
		const indices: number[] = [];
		const uvs: Vec2[] = [];
		f.indices.forEach((original: number, corner: number): void => {
			const mapped: number = remap[original];
			if (indices.length > 0 && indices[indices.length - 1] === mapped) return;
			indices.push(mapped);
			uvs.push(f.uvs[corner]);
		});
		if (indices.length > 1 && indices[0] === indices[indices.length - 1]) {
			indices.pop();
			uvs.pop();
		}
		if (indices.length < 3 || new Set(indices).size < indices.length) continue;
		faces.push({ indices, uvs });
	}
	return { name: part.name, atlas: part.atlas, positions, faces };
}
