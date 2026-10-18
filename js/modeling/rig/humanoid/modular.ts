import { ComponentOutput, MeshSpec } from './humanoid_types';
import { buildFromTemplate, HumanoidTemplate } from './template';
import { Vec3 } from './vec';

export interface ModularOptions {
	body_type: number | 'regular' | 'thin' | 'muscular' | 'heavy'
	head_size: number
	body_size: number
	shoulder_size: number
	shortness: number
	arm_size: number
	leg_size: number
	hip_fullness: number
	breast_size: number
	include_ears: boolean
	single_mesh: boolean
}
export const DEFAULT_MODULAR: ModularOptions = {
	body_type: 1, head_size: 1, body_size: 1, shoulder_size: 1, shortness: 0, arm_size: 1, leg_size: 1, hip_fullness: 0, breast_size: 0, include_ears: true, single_mesh: true,
};
const BODY_TYPES = { thin: 0, regular: 1, muscular: 2, heavy: 3 };
const BODY_SHAPES = ['Thin', 'Regular', 'Muscular', 'Fat'];

/** Bake source shape-key deltas into an editable, UV-preserving, weighted character. */
export function buildModularHumanoid(template: HumanoidTemplate, height: number, generateMesh: boolean, options: ModularOptions): ComponentOutput {
	if (!template.customization) throw new Error('This character has no body customization data. Reinstall the Bodiez templates.');
	const { customization } = template;
	options = { ...DEFAULT_MODULAR, ...options };
	const bodyType = typeof options.body_type === 'number' ? options.body_type : BODY_TYPES[options.body_type];
	const ranges: [number, number, number][] = [
		[bodyType, 0, 3], [options.hip_fullness, 0, 1], [options.breast_size, -1, 1],
		[options.head_size, 0.5, 2], [options.body_size, 0.6, 1.6], [options.shoulder_size, 0.6, 1.6],
		[options.shortness, 0, 1], [options.arm_size, 0.6, 1.5], [options.leg_size, 0.6, 1.5],
	];
	if (ranges.some(([v, min, max]) => !Number.isFinite(v) || v < min || v > max)) throw new Error('Invalid body customization');
	const lower = Math.floor(bodyType), upper = Math.min(3, lower + 1), blend = bodyType - lower;
	// Work at the imported scale, then normalize the chosen shape and its rig together.
	const output = buildFromTemplate(template, template.height);
	output.meshes.forEach((mesh, i) => {
		const morphs = customization.morphs[i];
		const amounts: [string, number][] = [[BODY_SHAPES[lower], 1 - blend], [BODY_SHAPES[upper], blend], ['Hip_Wide', options.hip_fullness]];
		if (customization.sex === 'female') amounts.push([options.breast_size < 0 ? 'Breast_Small' : 'Breast_Big', Math.abs(options.breast_size)]);
		for (const [shape, amount] of amounts) {
			if (!amount || !morphs[shape]) continue;
			mesh.vertices.forEach((v, index) => {
				for (let axis = 0; axis < 3; axis++) v[axis] += morphs[shape][index][axis] * amount;
			});
		}
	});
	// Apply regional rest-pose scaling through the imported skin weights. Each child
	// follows its resized parent; shared joints and all finger chains stay attached.
	const transforms = new Map<string, { origin: Vec3; head: Vec3; scale: Vec3 }>();
	const torso = new Set(['hips', 'spine', 'chest', 'upper_chest', 'neck_base']);
	for (const bone of output.bones) {
		const origin: Vec3 = [...bone.head];
		const parent = bone.parent ? transforms.get(bone.parent) : undefined;
		const scale: Vec3 = [1, 1, 1];
		if (torso.has(bone.id)) {
			scale[0] = scale[2] = options.body_size;
			scale[1] = 1 - options.shortness * 0.2;
		}
		if (bone.id === 'head') scale.fill(options.head_size);
		if (/^shoulder\.[LR]$/.test(bone.id)) scale[0] = options.shoulder_size;
		if (/^(upper_arm|lower_arm|hand|palm\.\d+|index_\d|middle_\d|ring_\d|pinky_\d|thumb_\d)\.[LR]$/.test(bone.id)) scale.fill(options.arm_size);
		if (/^(upper_leg|lower_leg|foot|toes)\.[LR]$/.test(bone.id)) scale.fill(options.leg_size * (1 - options.shortness * 0.45));
		const head = origin.map((v, axis) => parent ? parent.head[axis] + (v - parent.origin[axis]) * parent.scale[axis] : v) as Vec3;
		transforms.set(bone.id, { origin, head, scale });
		bone.tail = bone.tail.map((v, axis) => head[axis] + (v - origin[axis]) * scale[axis]) as Vec3;
		bone.head = head;
	}
	for (const mesh of output.meshes) {
		mesh.vertices = mesh.vertices.map((v, i) => {
			const point: Vec3 = [0, 0, 0];
			for (const [id, weight] of Object.entries(mesh.vertex_weights[i])) {
				const t = transforms.get(id)!;
				for (let axis = 0; axis < 3; axis++) point[axis] += weight * (t.head[axis] + (v[axis] - t.origin[axis]) * t.scale[axis]);
			}
			return point;
		});
	}
	const body = output.meshes[0];
	let floor = Infinity, top = -Infinity;
	for (const v of body.vertices) { floor = Math.min(floor, v[1]); top = Math.max(top, v[1]); }
	const scale = height / (top - floor);
	if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(scale) || scale <= 0) throw new Error('Invalid character height');
	const transform = (v: Vec3): Vec3 => [v[0] * scale, (v[1] - floor) * scale, v[2] * scale];
	output.bones.forEach(b => { b.head = transform(b.head); b.tail = transform(b.tail); });
	output.meshes.forEach(m => { m.vertices = m.vertices.map(transform); });
	if (!options.include_ears) output.meshes = output.meshes.slice(0, 1);
	if (!generateMesh) output.meshes = [];
	if (options.single_mesh && output.meshes.length > 1) {
		const merged: MeshSpec = { name: template.name, vertices: [], faces: [], vertex_weights: [], face_uvs: [], face_materials: [] };
		for (const mesh of output.meshes) {
			const offset = merged.vertices.length;
			merged.vertices.push(...mesh.vertices);
			merged.vertex_weights.push(...mesh.vertex_weights);
			merged.faces.push(...mesh.faces.map(face => face.map(v => v + offset)));
			merged.face_uvs!.push(...mesh.face_uvs!);
			merged.face_materials!.push(...mesh.face_materials!);
		}
		output.meshes = [merged];
	}
	return output;
}
