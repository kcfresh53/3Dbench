import type { MeshPart, Vec2, Vec3 } from '../core/types';
import type { GenerateResult } from '../core/generate';
import type { RoadLibrary } from '../core/library_types';
import { ROAD_ATLAS } from '../core/library_types';
import { BAKED_KEY } from './ids';
import type { TreeAtlas } from './tree_provider';

interface UndoAspects {
	elements: Mesh[];
	textures: Texture[];
	groups: Group[];
}

function undoAspects(): UndoAspects {
	return (Undo as unknown as { current_save: { aspects: UndoAspects } }).current_save.aspects;
}

function makeTexture(atlas: string, library: RoadLibrary, lookup: (key: string) => TreeAtlas | undefined): { texture: Texture; size: number } {
	if (atlas === ROAD_ATLAS) {
		const texture: Texture = new Texture({ sampling: 'smooth', name: 'roadscape_atlas.png', uv_width: library.atlasSize, uv_height: library.atlasSize } as never).fromDataURL(library.atlas).add(false) as Texture;
		return { texture, size: library.atlasSize };
	}
	const tree: TreeAtlas | undefined = lookup(atlas);
	if (!tree) throw new Error('A tree atlas is missing; wait for trees to finish building.');
	const texture: Texture = new Texture({ sampling: 'smooth', name: 'roadscape_trees.png', uv_width: tree.size, uv_height: tree.size } as never).fromDataURL(tree.dataUrl).add(false) as Texture;
	return { texture, size: tree.size };
}

function addPart(part: MeshPart, group: Group, source: Mesh, texture: Texture, size: number, created: Mesh[]): void {
	const mesh: Mesh = new Mesh({
		name: part.name,
		origin: [...source.origin],
		rotation: [...source.rotation],
		scale: [...((source as unknown as { scale?: ArrayVector3 }).scale ?? [1, 1, 1])],
		vertices: {},
		shading: 'flat',
	} as never)
		.addTo(group) as Mesh;
	created.push(mesh);
	mesh.init();
	const keys: string[] = part.positions.map((p: Vec3): string => mesh.addVertices(p)[0]);
	// Large buffers go through in slices so no single argument list becomes huge.
	for (let start: number = 0; start < part.faces.length; start += 2000) {
		mesh.addFaces(
			...part.faces.slice(start, start + 2000).map((face): MeshFace => {
				const vertices: string[] = face.indices.map((i: number): string => keys[i]);
				const uv: Record<string, Vec2> = {};
				vertices.forEach((key: string, i: number): void => {
					uv[key] = [face.uvs[i][0] * size, face.uvs[i][1] * size];
				});
				return new MeshFace(mesh, { vertices, uv, texture: texture.uuid } as never);
			}),
		);
	}
}

/**
 * Replaces a live road network with ordinary meshes: one mesh per part, one texture per atlas.
 * One undo step; undoing restores the editable network.
 */
export function bakeRoad(result: GenerateResult, library: RoadLibrary, lookup: (key: string) => TreeAtlas | undefined, source: Mesh): Group {
	Undo.initEdit({ outliner: true, elements: [source], groups: [], textures: [], selection: true } as never);
	const elements: Mesh[] = [];
	const groups: Group[] = [];
	const textures: Texture[] = [];
	try {
		const group: Group = new Group({ name: 'Roadscape road' }).addTo(source.parent ?? Outliner.ROOT).init() as Group;
		group.createUniqueName();
		groups.push(group);
		const tracked: Group[] = undoAspects().groups;
		if (!tracked.includes(group)) tracked.push(group);
		(group as unknown as Record<string, string>)[BAKED_KEY] = '';
		const made: Map<string, { texture: Texture; size: number }> = new Map();
		for (const part of result.parts) {
			let entry: { texture: Texture; size: number } | undefined = made.get(part.atlas);
			if (!entry) {
				entry = makeTexture(part.atlas, library, lookup);
				made.set(part.atlas, entry);
				textures.push(entry.texture);
			}
			addPart(part, group, source, entry.texture, entry.size, elements);
		}
		source.remove();
		unselectAllElements();
		group.select();
		Undo.finishEdit('Bake Roadscape to Meshes', { outliner: true, groups, elements, textures, selection: true } as never);
		Canvas.updateAll();
		return group;
	} catch (error) {
		const aspects: UndoAspects = undoAspects();
		aspects.elements.push(...elements);
		aspects.textures.push(...textures);
		aspects.elements = aspects.elements.filter((e: Mesh): boolean => Outliner.elements.includes(e));
		aspects.textures = aspects.textures.filter((t: Texture): boolean => Texture.all.includes(t));
		aspects.groups = aspects.groups.filter((g: Group): boolean => Group.all.includes(g));
		Undo.cancelEdit(true);
		throw error;
	}
}
