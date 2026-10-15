import { ArmatureBone } from '../../outliner/types/armature_bone';

type WeightMap = Map<string, Map<number, number>>;

/** Reads all weights of a mesh into memory: vertex key -> (bone index -> weight) */
export function readWeights(mesh: Mesh, bones: ArmatureBone[]): WeightMap {
	const result: WeightMap = new Map();
	for (const vkey in mesh.vertices) {
		const influences: Map<number, number> = new Map();
		bones.forEach((bone: ArmatureBone, i: number) => {
			const weight: number = bone.getVertexWeight(mesh, vkey);
			if (weight > 0) influences.set(i, weight);
		});
		result.set(vkey, influences);
	}
	return result;
}

export function writeWeights(mesh: Mesh, bones: ArmatureBone[], weights: WeightMap, vertex_keys: Iterable<string>): void {
	for (const vkey of vertex_keys) {
		const influences: Map<number, number> | undefined = weights.get(vkey);
		bones.forEach((bone: ArmatureBone, i: number) => {
			bone.setVertexWeight(mesh, vkey, influences?.get(i) ?? 0);
		});
	}
}

/** Keeps the strongest influences and scales the rest so they sum up to one */
export function normalizeInfluences(influences: Map<number, number>, max_influences: number): Map<number, number> {
	const ranked: [number, number][] = Array.from(influences.entries()).sort((a, b) => b[1] - a[1]).slice(0, max_influences);
	const total: number = ranked.reduce((sum: number, [, w]: [number, number]) => sum + w, 0);
	const result: Map<number, number> = new Map();
	if (total <= 1e-9) return result;
	for (const [bone, weight] of ranked) result.set(bone, weight / total);
	return result;
}

function vertexNeighbors(mesh: Mesh): Map<string, Set<string>> {
	const neighbors: Map<string, Set<string>> = new Map();
	for (const vkey in mesh.vertices) neighbors.set(vkey, new Set());
	for (const fkey in mesh.faces) {
		const sorted: string[] = mesh.faces[fkey].getSortedVertices();
		sorted.forEach((vkey: string, i: number) => {
			const next: string = sorted[(i + 1) % sorted.length];
			neighbors.get(vkey)?.add(next);
			neighbors.get(next)?.add(vkey);
		});
	}
	return neighbors;
}

/** Laplacian smoothing of the weights over the mesh surface */
export function smoothWeights(mesh: Mesh, bones: ArmatureBone[], vertex_keys: string[], iterations: number, strength: number, max_influences: number): void {
	const neighbors: Map<string, Set<string>> = vertexNeighbors(mesh);
	let weights: WeightMap = readWeights(mesh, bones);
	for (let it: number = 0; it < iterations; it++) {
		const next: WeightMap = new Map(weights);
		for (const vkey of vertex_keys) {
			const around: Set<string> = neighbors.get(vkey) as Set<string>;
			if (!around.size) continue;
			const blended: Map<number, number> = new Map();
			const own: Map<number, number> = weights.get(vkey) as Map<number, number>;
			own.forEach((w: number, bone: number) => blended.set(bone, (1 - strength) * w));
			for (const other of around) {
				weights.get(other)?.forEach((w: number, bone: number) => {
					blended.set(bone, (blended.get(bone) ?? 0) + strength * w / around.size);
				});
			}
			next.set(vkey, normalizeInfluences(blended, max_influences));
		}
		weights = next;
	}
	writeWeights(mesh, bones, weights, vertex_keys);
}

export function limitWeights(mesh: Mesh, bones: ArmatureBone[], vertex_keys: string[], max_influences: number): void {
	const weights: WeightMap = readWeights(mesh, bones);
	for (const vkey of vertex_keys) {
		weights.set(vkey, normalizeInfluences(weights.get(vkey) as Map<number, number>, max_influences));
	}
	writeWeights(mesh, bones, weights, vertex_keys);
}
