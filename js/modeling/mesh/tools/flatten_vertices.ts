export type FlattenAxis = 'x' | 'y' | 'z';
export type FlattenTarget = 'average' | 'min' | 'max' | 'first';

/** Moves all given vertices onto a single plane perpendicular to the axis (the equivalent of scaling to zero in Blender). */
export function flattenVertices(mesh: Mesh, vertex_keys: string[], axis: FlattenAxis, target: FlattenTarget): number {
	const index: number = axis == 'x' ? 0 : axis == 'y' ? 1 : 2;
	const keys: string[] = vertex_keys.filter((key: string) => mesh.vertices[key]);
	if (!keys.length) return 0;
	const values: number[] = keys.map((key: string) => mesh.vertices[key][index]);
	let value: number;
	switch (target) {
		case 'min': value = Math.min(...values); break;
		case 'max': value = Math.max(...values); break;
		case 'first': value = values[0]; break;
		default: value = values.reduce((a: number, b: number) => a + b, 0) / values.length;
	}
	for (const key of keys) mesh.vertices[key][index] = value;
	return keys.length;
}
