import { BoneSpec, ComponentOutput, MeshSpec } from './humanoid_types';
import { Vec3 } from './vec';

/** User-owned assets stay outside the source tree and are loaded only on request. */
export interface HumanoidTemplate extends ComponentOutput {
	schema_version: 1
	name: string
	source: string
	height: number
	textures: { name: string; file: string }[]
}

export function validateTemplate(value: unknown): asserts value is HumanoidTemplate {
	const t = value as HumanoidTemplate;
	if (!t || t.schema_version !== 1 || !(t.height > 0) || !Number.isFinite(t.height) || !Array.isArray(t.bones) || !Array.isArray(t.meshes) || !Array.isArray(t.textures)) throw new Error('Invalid humanoid template');
	const point = (p: unknown): p is Vec3 => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
	const ids = new Set<string>();
	for (const b of t.bones) {
		if (!b.id || ids.has(b.id) || (b.parent && !ids.has(b.parent)) || !point(b.head) || !point(b.tail)) throw new Error('Invalid template skeleton');
		ids.add(b.id);
	}
	for (const m of t.meshes) {
		if (!Array.isArray(m.vertices) || !m.vertices.every(point) || m.vertex_weights?.length !== m.vertices.length || !Array.isArray(m.faces) || m.face_uvs?.length !== m.faces.length || m.face_materials?.length !== m.faces.length) throw new Error('Invalid template mesh');
		for (const w of m.vertex_weights) if (!Object.keys(w).length || Object.entries(w).some(([id, weight]) => !ids.has(id) || !Number.isFinite(weight) || weight < 0)) throw new Error('Invalid template weights');
		m.faces.forEach((f, i) => {
			if ((f.length !== 3 && f.length !== 4) || f.some(v => !Number.isInteger(v) || v < 0 || v >= m.vertices.length)) throw new Error('Invalid template face');
			if (m.face_uvs![i].length !== f.length || m.face_uvs![i].some(uv => uv.length !== 2 || !uv.every(Number.isFinite))) throw new Error('Invalid template UVs');
			const material = m.face_materials![i];
			if (!Number.isInteger(material) || material < 0 || material >= t.textures.length) throw new Error('Invalid template material');
		});
	}
	if (t.textures.some(texture => !/^[a-zA-Z0-9_-]+\.png$/.test(texture.file))) throw new Error('Invalid template texture path');
}

/** Only a uniform scale is applied. No remeshing, smoothing, UV unwrap, or weight generation. */
export function buildFromTemplate(template: HumanoidTemplate, height: number, generate_mesh = true): ComponentOutput {
	validateTemplate(template);
	if (!Number.isFinite(height) || height <= 0) throw new Error('Height must be positive');
	const factor = height / template.height;
	const point = (v: Vec3): Vec3 => v.map(x => x * factor) as Vec3;
	const bones: BoneSpec[] = template.bones.map(b => ({ ...b, head: point(b.head), tail: point(b.tail) }));
	const meshes: MeshSpec[] = generate_mesh ? template.meshes.map(m => ({
		...m, vertices: m.vertices.map(point), faces: m.faces.map(f => f.slice()),
		vertex_weights: m.vertex_weights.map(w => ({ ...w })),
		face_uvs: m.face_uvs!.map(f => f.map(uv => [...uv] as [number, number])),
		face_materials: m.face_materials!.slice(),
	})) : [];
	return { bones, meshes };
}

export async function loadHumanoidTemplate(id: string): Promise<HumanoidTemplate> {
	if (!/^chibi_(male|female)$/.test(id)) throw new Error('Unknown local preset');
	const base = new URL('./.local-assets/humanoid/', location.href);
	if (base.protocol === 'file:') {
		const { fs } = await import('../../../native_apis');
		let template: HumanoidTemplate;
		try {
			template = JSON.parse(fs.readFileSync(new URL(id + '.json', base), 'utf8'));
		} catch {
			throw new Error('The purchased template has not been installed locally. See README → Local character templates.');
		}
		validateTemplate(template);
		return template;
	}
	const response = await fetch(new URL(id + '.json', base));
	if (!response.ok) throw new Error('The purchased template has not been installed locally. See README → Local character templates.');
	const template = await response.json();
	validateTemplate(template);
	return template;
}
