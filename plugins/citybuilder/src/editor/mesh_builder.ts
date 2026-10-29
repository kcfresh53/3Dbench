import type { PartFace, Vec2, Vec3 } from '../core/types';

/** Adds a polygon mesh to a Blockbench group. UVs are 0..1 and are converted to texture pixels. */
export function addMesh(
	name: string,
	positions: Vec3[],
	faces: PartFace[],
	texture: Texture | null,
	parent: Group,
	shading: 'smooth' | 'flat',
	created: Mesh[],
	origin: Vec3 = [0, 0, 0],
): Mesh {
	const tw: number = texture ? texture.getUVWidth() : Project?.texture_width || 16;
	const th: number = texture ? texture.getUVHeight() : Project?.texture_height || 16;
	const mesh: Mesh = new Mesh({ name, origin, vertices: {}, shading } as never).addTo(parent).init() as Mesh;
	created.push(mesh);
	// Add vertices in batches: spreading a very large array into one call overflows the stack.
	const keys: string[] = [];
	for (let i: number = 0; i < positions.length; i += 4000) keys.push(...mesh.addVertices(...positions.slice(i, i + 4000)));
	const meshFaces: MeshFace[] = faces.map((face: PartFace): MeshFace => {
		const faceKeys: string[] = face.indices.map((i: number): string => keys[i]);
		const uv: Record<string, Vec2> = {};
		faceKeys.forEach((key: string, i: number): void => {
			uv[key] = [face.uvs[i][0] * tw, face.uvs[i][1] * th];
		});
		return new MeshFace(mesh, { vertices: faceKeys, uv, texture: texture ? texture.uuid : undefined } as never);
	});
	for (let i = 0; i < meshFaces.length; i += 4000) mesh.addFaces(...meshFaces.slice(i, i + 4000));
	return mesh;
}

/** Everything an undoable "create some objects" step needs to track. */
export interface Created {
	groups: Group[];
	meshes: Mesh[];
	textures: Texture[];
}

export function beginCreate(): Created {
	Undo.initEdit({ outliner: true, groups: [], elements: [], textures: [], selection: true } as never);
	return { groups: [], meshes: [], textures: [] };
}

export function finishCreate(label: string, created: Created): void {
	Undo.finishEdit(label, { outliner: true, groups: created.groups, elements: created.meshes, textures: created.textures, selection: true } as never);
	Canvas.updateAll();
}

/** Rolls back a half-finished creation. */
export function abortCreate(created: Created): void {
	const aspects = (Undo as unknown as { current_save?: { aspects: { elements: Mesh[]; textures: Texture[]; groups: Group[] } } }).current_save?.aspects;
	if (aspects) {
		aspects.elements.push(...created.meshes);
		aspects.textures.push(...created.textures);
		aspects.groups.push(...created.groups);
		aspects.elements = aspects.elements.filter((e: Mesh): boolean => Outliner.elements.includes(e));
		aspects.textures = aspects.textures.filter((t: Texture): boolean => Texture.all.includes(t));
		aspects.groups = aspects.groups.filter((g: Group): boolean => Group.all.includes(g));
	}
	Undo.cancelEdit(true);
}

export function newGroup(name: string, parent: Group | 'root', created: Created): Group {
	const group: Group = new Group({ name }).addTo(parent === 'root' ? Outliner.ROOT : parent).init() as Group;
	created.groups.push(group);
	return group;
}

export function newTexture(name: string, dataUrl: string, size: number, created: Created): Texture {
	const texture: Texture = new Texture({ sampling: 'smooth', name, uv_width: size, uv_height: size } as never).fromDataURL(dataUrl).add(false) as Texture;
	created.textures.push(texture);
	return texture;
}
