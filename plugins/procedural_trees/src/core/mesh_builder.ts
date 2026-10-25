import type { MeshData, MeshFaceData, Vec2, Vec3 } from './types';

/** Accumulates shared vertices and n-gon faces (3 or 4 sides). */
export class MeshBuilder {
	private positions: Vec3[] = [];
	private faces: MeshFaceData[] = [];

	addVertex(position: Vec3): number {
		this.positions.push(position);
		return this.positions.length - 1;
	}

	position(index: number): Vec3 {
		return this.positions[index];
	}

	addFace(indices: number[], uvs: Vec2[]): void {
		this.faces.push({ indices, uvs });
	}

	toData(): MeshData {
		return { positions: this.positions, faces: this.faces };
	}
}

export function countTriangles(data: MeshData): number {
	let total = 0;
	for (const face of data.faces) total += face.indices.length - 2;
	return total;
}

export function translateMesh(data: MeshData, offset: Vec3): MeshData {
	return {
		positions: data.positions.map((p: Vec3): Vec3 => [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]]),
		faces: data.faces,
	};
}

export function mergeMeshData(a: MeshData, b: MeshData): MeshData {
	const base: number = a.positions.length;
	return {
		positions: [...a.positions, ...b.positions],
		faces: [
			...a.faces,
			...b.faces.map((f: MeshFaceData): MeshFaceData => ({
				indices: f.indices.map((i: number): number => i + base),
				uvs: f.uvs,
			})),
		],
	};
}

/** Width of the XZ footprint, used to space LODs apart. */
export function footprintWidth(data: MeshData): number {
	if (data.positions.length === 0) return 0;
	let minX = Infinity;
	let maxX = -Infinity;
	let minZ = Infinity;
	let maxZ = -Infinity;
	for (const p of data.positions) {
		minX = Math.min(minX, p[0]);
		maxX = Math.max(maxX, p[0]);
		minZ = Math.min(minZ, p[2]);
		maxZ = Math.max(maxZ, p[2]);
	}
	return Math.max(maxX - minX, maxZ - minZ);
}
