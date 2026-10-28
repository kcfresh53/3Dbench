import type { PartFace, PropMesh, Vec2, Vec3 } from './types';
import { proceduralProp } from './procedural_props';

export interface MaterialTile {
	/** `[u, v, size]` of the tile inside the atlas, normalised 0..1, origin top-left. */
	tile: [number, number, number];
	image: string | null;
}

/** Everything the generator needs from the bundled artwork. */
export interface RoadLibrary {
	sourceVersion: string;
	sourceSha256: string;
	author: string;
	atlasSize: number;
	/** PNG data URL of the shared atlas. Empty in tests. */
	atlas: string;
	materials: Record<string, MaterialTile>;
	/** Optimised props, one model each. */
	props: Record<string, PropMesh>;
}

/** A prop whose UVs are already expressed in atlas space. */
export interface PropSource {
	name: string;
	atlas: string;
	positions: Vec3[];
	faces: PartFace[];
	triangles: number;
}

export const ROAD_ATLAS: string = 'road';

export function tileUv(library: RoadLibrary, material: string, u: number, v: number): Vec2 {
	const entry: MaterialTile | undefined = library.materials[material];
	if (!entry) throw new Error(`Missing atlas material ${material}`);
	const [x, y, size]: [number, number, number] = entry.tile;
	return [x + Math.min(1, Math.max(0, u)) * size, y + Math.min(1, Math.max(0, v)) * size];
}

const cache: WeakMap<RoadLibrary, Map<string, PropSource>> = new WeakMap();

/** Converts a library prop to atlas space once and caches the result. */
export function propSource(library: RoadLibrary, name: string): PropSource {
	let perLibrary: Map<string, PropSource> | undefined = cache.get(library);
	if (!perLibrary) {
		perLibrary = new Map();
		cache.set(library, perLibrary);
	}
	const found: PropSource | undefined = perLibrary.get(name);
	if (found) return found;
	const prop: PropMesh | undefined = library.props[name] ?? proceduralProp(name);
	if (!prop) throw new Error(`Missing prop ${name}`);
	const faces: PartFace[] = prop.faces.map((f): PartFace => ({
		indices: f.indices.slice(),
		uvs: f.uvs.map((uv: Vec2): Vec2 => tileUv(library, f.material, uv[0], uv[1])),
	}));
	let triangles: number = 0;
	for (const f of faces) triangles += f.indices.length - 2;
	const source: PropSource = { name, atlas: ROAD_ATLAS, positions: prop.positions, faces, triangles };
	perLibrary.set(name, source);
	return source;
}
