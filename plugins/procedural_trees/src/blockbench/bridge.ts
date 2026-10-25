import type { MeshData, PresetName, TreeLod, TreeParams, Vec2, Vec3 } from '../core/types';
import { presetParams, PRESET_NAMES } from '../ui/presets';
import { mergeMeshData } from '../core/mesh_builder';

/** Group property that marks a generated tree and stores the settings to edit it again. */
export const TREE_KEY = 'procedural_tree';

interface StoredTree {
	version: 1 | 2;
	preset: PresetName;
	params: Partial<TreeParams>;
	texture: string;
}

export function readStoredTree(group: Group): { preset: PresetName; params: TreeParams } | null {
	try {
		const data: StoredTree = JSON.parse((group as unknown as Record<string, string>)[TREE_KEY]) as StoredTree;
		if (![1, 2].includes(data.version) || !PRESET_NAMES.includes(data.preset) || !data.params) return null;
		return { preset: data.preset, params: { ...presetParams(data.preset), ...data.params, ...(data.version === 1 ? { useBundledTextures: false, spreadLods: true, barkImage: '', leafImage: '' } : {}) } };
	} catch {
		return null;
	}
}

export function selectedTreeGroup(): Group | null {
	let node: unknown = Group.first_selected || (Outliner.selected[0] as OutlinerNode | undefined)?.parent;
	while (node && typeof node === 'object') {
		if ((node as Record<string, string>)[TREE_KEY]) return node as Group;
		node = (node as { parent?: unknown }).parent;
	}
	return null;
}

function buildMesh(name: string, data: MeshData, texture: Texture, parent: Group, shading: 'smooth' | 'flat', created: Mesh[]): Mesh {
	const tw: number = texture.getUVWidth();
	const th: number = texture.getUVHeight();
	const mesh: Mesh = new Mesh({ name, origin: [0, 0, 0], vertices: {}, shading } as never).addTo(parent).init() as Mesh;
	created.push(mesh);
	const keys: string[] = data.positions.map((p: Vec3): string => mesh.addVertices(p)[0]);
	const faces: MeshFace[] = data.faces.map((face): MeshFace => {
		const faceKeys: string[] = face.indices.map((i: number): string => keys[i]);
		const uv: Record<string, Vec2> = {};
		faceKeys.forEach((key: string, i: number): void => {
			uv[key] = [face.uvs[i][0] * tw, face.uvs[i][1] * th];
		});
		return new MeshFace(mesh, { vertices: faceKeys, uv, texture: texture.uuid } as never);
	});
	mesh.addFaces(...faces);
	return mesh;
}

/**
 * Creates (or regenerates) a tree as one undo step: one atlas texture, a group per LOD,
 * and trunk/foliage meshes inside. Regenerating replaces the group's contents.
 */
export function createTreeInProject(
	lods: TreeLod[],
	atlasUrl: string,
	params: TreeParams,
	preset: PresetName,
	existing: Group | null,
): void {
	const oldGroups: Group[] = existing ? [existing] : [];
	const oldElements: OutlinerElement[] = [];
	existing?.forEachChild((child: OutlinerNode): void => {
		if (child instanceof Group) oldGroups.push(child);
		else oldElements.push(child as OutlinerElement);
	});

	// Drop the previous atlas only if nothing outside this tree still uses it.
	let oldTexture: Texture | undefined;
	try {
		const stored: StoredTree = JSON.parse((existing as unknown as Record<string, string>)[TREE_KEY]) as StoredTree;
		oldTexture = Texture.all.find((t: Texture): boolean => t.uuid === stored.texture);
	} catch {
		/* new tree */
	}
	const canRemoveTexture: boolean =
		!!oldTexture &&
		!Outliner.elements.some(
			(el: OutlinerElement): boolean =>
				!oldElements.includes(el) &&
				'faces' in el &&
				Object.values((el as Mesh).faces).some((f: MeshFace): boolean => f.texture === oldTexture!.uuid),
		);

	Undo.initEdit({
		outliner: true,
		groups: oldGroups,
		elements: oldElements.slice(),
		textures: canRemoveTexture && oldTexture ? [oldTexture] : [],
		selection: true,
	} as never);

	const elements: Mesh[] = [];
	const groups: Group[] = [];
	const textures: Texture[] = [];
	try {
		const texture: Texture = new Texture({
			name: 'tree_atlas.png',
			uv_width: params.textureSize,
			uv_height: params.textureSize,
		} as never)
			.fromDataURL(atlasUrl)
			.add(false) as Texture;
		textures.push(texture);

		const group: Group =
			existing ?? (new Group({ name: `${preset.split('_')[0]} tree` }).addTo(Outliner.ROOT).init() as Group);
		if (!existing) group.createUniqueName();
		groups.push(group);
		const trackedGroups = (Undo as unknown as { current_save: { aspects: { groups: Group[] } } }).current_save.aspects.groups;
		if (!trackedGroups.includes(group)) trackedGroups.push(group);
		if (existing) for (const child of [...existing.children]) child.remove();
		if (canRemoveTexture && oldTexture) oldTexture.remove(true);

		const stored: Partial<StoredTree> & { params: Record<string, unknown> } = {
			version: 2,
			preset,
			params: { ...params },
			texture: texture.uuid,
		};
		(group as unknown as Record<string, string>)[TREE_KEY] = JSON.stringify(stored);

		const stylized: boolean = params.variant === 'stylized';
		lods.forEach((lod: TreeLod, index: number): void => {
			const lodGroup: Group = new Group({ name: `LOD${index}` }).addTo(group).init() as Group;
			groups.push(lodGroup);
			trackedGroups.push(lodGroup);
			const parts: Array<[string, MeshData, 'smooth' | 'flat']> = params.separateFoliage
				? [
						['trunk', lod.trunk, stylized ? 'flat' : 'smooth'],
						['foliage', lod.foliage, 'flat'],
					]
				: [['tree', mergeMeshData(lod.trunk, lod.foliage), 'flat']];
			for (const [partName, data, shading] of parts) {
				if (data.faces.length === 0) continue;
				buildMesh(`LOD${index}_${partName}`, data, texture, lodGroup, shading, elements);
			}
		});

		unselectAllElements();
		group.select();
		Undo.finishEdit(existing ? 'Regenerate tree' : 'Generate tree', {
			outliner: true,
			groups,
			elements,
			textures,
			selection: true,
		} as never);
	} catch (error) {
		const aspects = (Undo as unknown as { current_save: { aspects: { elements: Mesh[]; textures: Texture[]; groups: Group[] } } }).current_save.aspects;
		aspects.elements.push(...elements);
		aspects.textures.push(...textures);
		// The rollback reference must describe what still exists, so removed atlases
		// are recreated rather than treated as objects that can be updated in place.
		aspects.elements = aspects.elements.filter(element => Outliner.elements.includes(element));
		aspects.textures = aspects.textures.filter(texture => Texture.all.includes(texture));
		aspects.groups = aspects.groups.filter(group => Group.all.includes(group));
		Undo.cancelEdit(true);
		throw error;
	}
	Canvas.updateAll();
}
