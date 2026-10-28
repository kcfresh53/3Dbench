import type { GameReadySettings } from '../core/gameready/settings';
import { makeGameReady } from '../core/gameready/pipeline';
import type { GameReadyResult } from '../core/gameready/pipeline';
import type { PropFace, PropMesh, Vec2, Vec3 } from '../core/types';
import { meshTriangles } from '../core/buildings/mesh';
import { abortCreate, addMesh, beginCreate, finishCreate, newGroup } from './mesh_builder';
import type { Created } from './mesh_builder';

/** Meshes that are selected, or sit inside a selected group. */
export function meshesToProcess(): Mesh[] {
	const found: Set<Mesh> = new Set<Mesh>(Mesh.selected);
	for (const group of Group.multi_selected ?? (Group.first_selected ? [Group.first_selected] : [])) {
		group.forEachChild((node: OutlinerNode): void => {
			if (node instanceof Mesh) found.add(node);
		}, undefined, true);
	}
	return [...found];
}

function propFrom(mesh: Mesh): { prop: PropMesh; textures: Map<string, Texture | null> } {
	const keys: string[] = Object.keys(mesh.vertices);
	const index: Map<string, number> = new Map<string, number>(keys.map((k: string, i: number): [string, number] => [k, i]));
	const positions: Vec3[] = keys.map((k: string): Vec3 => [mesh.vertices[k][0], mesh.vertices[k][1], mesh.vertices[k][2]]);
	const textures: Map<string, Texture | null> = new Map<string, Texture | null>();
	const faces: PropFace[] = [];
	for (const face of Object.values(mesh.faces)) {
		if (face.vertices.length < 3) continue;
		const texture: Texture | null = face.getTexture() || null;
		const tw: number = texture ? texture.getUVWidth() : Project?.texture_width || 16;
		const th: number = texture ? texture.getUVHeight() : Project?.texture_height || 16;
		const material: string = texture ? texture.uuid : '';
		textures.set(material, texture);
		const sorted: string[] = face.getSortedVertices();
		faces.push({
			indices: sorted.map((k: string): number => index.get(k) as number),
			uvs: sorted.map((k: string): Vec2 => [(face.uv[k]?.[0] ?? 0) / tw, (face.uv[k]?.[1] ?? 0) / th]),
			material,
		});
	}
	return { prop: { positions, faces }, textures };
}

export interface GameReadySummary {
	name: string;
	before: number;
	after: number[];
	hidden: number;
}

/** Keeps only the vertices the faces use, so unused ones do not float in the result. */
function compact(positions: Vec3[], faces: PropFace[]): { positions: Vec3[]; faces: Array<{ indices: number[]; uvs: Vec2[] }> } {
	const remap: Map<number, number> = new Map<number, number>();
	const out: Vec3[] = [];
	const mapped = faces.map((f: PropFace): { indices: number[]; uvs: Vec2[] } => ({
		uvs: f.uvs,
		indices: f.indices.map((i: number): number => {
			let to: number | undefined = remap.get(i);
			if (to === undefined) {
				to = out.length;
				out.push(positions[i]);
				remap.set(i, to);
			}
			return to;
		}),
	}));
	return { positions: out, faces: mapped };
}

/**
 * Removes faces nobody can see, simplifies what is left and writes three levels of detail as new
 * meshes beside the original, which stays untouched. One undo step.
 */
export function makeMeshesGameReady(settings: GameReadySettings): GameReadySummary[] {
	const meshes: Mesh[] = meshesToProcess();
	if (meshes.length === 0) throw new Error('Select a mesh (or a group of meshes) first.');
	const created: Created = beginCreate();
	const summary: GameReadySummary[] = [];
	try {
		for (const mesh of meshes) {
			const { prop, textures } = propFrom(mesh);
			if (prop.faces.length === 0) continue;
			const result: GameReadyResult = makeGameReady(prop, settings);
			const parent = mesh.parent instanceof Group ? mesh.parent : 'root';
			const group: Group = newGroup(`${mesh.name} (game ready)`, parent, created);
			result.lods.forEach((lod, i: number): void => {
				const byMaterial: Map<string, PropFace[]> = new Map<string, PropFace[]>();
				for (const face of lod.mesh.faces) byMaterial.set(face.material, [...(byMaterial.get(face.material) ?? []), face]);
				const lodGroup: Group = newGroup(`LOD${i}`, group, created);
				// A Blockbench mesh can mix textures per face, but one mesh per texture keeps the output simple to export.
				for (const [material, faces] of byMaterial) {
					const part = compact(lod.mesh.positions, faces);
					addMesh(`${mesh.name}_LOD${i}${byMaterial.size > 1 ? `_${material.slice(0, 4)}` : ''}`, part.positions, part.faces, textures.get(material) ?? null, lodGroup, mesh.shading === 'smooth' ? 'smooth' : 'flat', created.meshes, [mesh.origin[0], mesh.origin[1], mesh.origin[2]]);
				}
			});
			summary.push({ name: mesh.name, before: meshTriangles(prop), after: result.lods.map((l) => l.triangles), hidden: result.removedHidden });
		}
		finishCreate('Make game ready', created);
		return summary;
	} catch (error) {
		abortCreate(created);
		throw error;
	}
}
