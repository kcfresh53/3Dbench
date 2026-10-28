import type { MeshPart } from '../core/types';
import type { RoadLibrary } from '../core/library_types';
import { ROAD_ATLAS } from '../core/library_types';
import type { TreeAtlas } from './tree_provider';
import { LIVE_BODY_NAME } from './ids';

/** Turns generated parts into one draw call per atlas. Nothing is added to the project. */
export function geometryForParts(parts: MeshPart[]): THREE.BufferGeometry {
	const positions: number[] = [];
	const uvs: number[] = [];
	for (const part of parts) {
		for (const face of part.faces) {
			for (let i: number = 1; i < face.indices.length - 1; i++) {
				for (const j of [0, i, i + 1]) {
					const p: [number, number, number] = part.positions[face.indices[j]];
					positions.push(p[0], p[1], p[2]);
					uvs.push(face.uvs[j][0], face.uvs[j][1]);
				}
			}
		}
	}
	const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	geometry.computeVertexNormals();
	geometry.computeBoundingSphere();
	return geometry;
}

/** Shares one texture and material per atlas across every live road. */
export class MaterialPool {
	private readonly materials: Map<string, THREE.MeshBasicMaterial> = new Map();
	private readonly textures: Map<string, THREE.Texture> = new Map();

	constructor(
		private readonly library: RoadLibrary,
		private readonly lookup: (key: string) => TreeAtlas | undefined,
		private readonly onLoaded: () => void,
	) {}

	material(atlas: string): THREE.MeshBasicMaterial | null {
		const existing: THREE.MeshBasicMaterial | undefined = this.materials.get(atlas);
		if (existing) return existing;
		const url: string | undefined = atlas === ROAD_ATLAS ? this.library.atlas : this.lookup(atlas)?.dataUrl;
		if (!url) return null;
		const texture: THREE.Texture = new THREE.TextureLoader().load(url, (): void => this.onLoaded());
		texture.flipY = false;
		texture.magFilter = atlas === ROAD_ATLAS ? THREE.LinearFilter : THREE.NearestFilter;
		const material: THREE.MeshBasicMaterial = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, alphaTest: 0.5 });
		this.textures.set(atlas, texture);
		this.materials.set(atlas, material);
		return material;
	}

	dispose(): void {
		for (const m of this.materials.values()) m.dispose();
		for (const t of this.textures.values()) t.dispose();
		this.materials.clear();
		this.textures.clear();
	}
}

export function makeRoadBody(parts: MeshPart[], pool: MaterialPool): THREE.Group {
	const group: THREE.Group = new THREE.Group();
	group.name = LIVE_BODY_NAME;
	(group as unknown as { no_export: boolean }).no_export = true;
	const byAtlas: Map<string, MeshPart[]> = new Map();
	for (const part of parts) {
		const list: MeshPart[] = byAtlas.get(part.atlas) ?? [];
		list.push(part);
		byAtlas.set(part.atlas, list);
	}
	for (const [atlas, list] of byAtlas) {
		const material: THREE.MeshBasicMaterial | null = pool.material(atlas);
		if (!material) continue;
		const object: THREE.Mesh = new THREE.Mesh(geometryForParts(list), material);
		(object as unknown as { no_export: boolean }).no_export = true;
		object.name = `${LIVE_BODY_NAME} (${atlas})`;
		group.add(object);
	}
	return group;
}

export function disposeBody(body: THREE.Object3D | null): void {
	if (!body) return;
	body.traverse((o: THREE.Object3D): void => {
		const mesh: THREE.Mesh = o as THREE.Mesh;
		mesh.geometry?.dispose();
	});
	body.removeFromParent();
}
