/**
 * Minimal binary glTF (.glb) reader for skeletons and their animation clips.
 * It only reads what retargeting needs: the first skin, node transforms and translation / rotation channels.
 */
import { Skeleton, Pose, JointTransform, composeTransforms } from './skeleton';
import { Vec3, Quat, quatSlerp, lerp, quatNormalize } from './math';

export interface ClipTrack {
	times: number[];
	/** Flat values, `stride` numbers per key */
	values: number[];
	stride: 3 | 4;
	step: boolean;
}

export interface SourceClip {
	name: string;
	duration: number;
	/** Joint index -> track */
	translation: Map<number, ClipTrack>;
	rotation: Map<number, ClipTrack>;
}

export interface GltfAsset {
	skeleton: Skeleton;
	clips: SourceClip[];
}

interface GltfNode {
	name?: string;
	children?: number[];
	translation?: number[];
	rotation?: number[];
	scale?: number[];
}
interface GltfAccessor {
	bufferView: number;
	byteOffset?: number;
	componentType: number;
	count: number;
	type: string;
}
interface GltfJson {
	nodes: GltfNode[];
	scenes?: { nodes: number[] }[];
	scene?: number;
	skins?: { joints: number[] }[];
	accessors: GltfAccessor[];
	bufferViews: { byteOffset?: number; byteStride?: number }[];
	animations?: {
		name?: string;
		samplers: { input: number; output: number; interpolation?: string }[];
		channels: { sampler: number; target: { node: number; path: string } }[];
	}[];
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC3: 3, VEC4: 4 };
const FLOAT: number = 5126;

export function readGlb(data: Uint8Array): GltfAsset {
	const view: DataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
	if (view.getUint32(0, true) != 0x46546c67) throw new Error('Not a binary glTF file');
	let json: GltfJson | null = null;
	let bin: Uint8Array | null = null;
	let offset: number = 12;
	while (offset < data.byteLength) {
		const length: number = view.getUint32(offset, true);
		const type: number = view.getUint32(offset + 4, true);
		const chunk: Uint8Array = data.subarray(offset + 8, offset + 8 + length);
		if (type == 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk)) as GltfJson;
		else if (type == 0x004e4942) bin = chunk;
		offset += 8 + length;
	}
	if (!json || !bin) throw new Error('glTF is missing its JSON or binary chunk');
	return buildAsset(json, bin);
}

function readAccessor(json: GltfJson, bin: Uint8Array, index: number): number[] {
	const accessor: GltfAccessor = json.accessors[index];
	if (accessor.componentType != FLOAT) throw new Error('Only float animation data is supported');
	const components: number = COMPONENTS[accessor.type];
	const buffer_view = json.bufferViews[accessor.bufferView];
	const start: number = (buffer_view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
	const stride: number = buffer_view.byteStride ?? components * 4;
	const view: DataView = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
	const result: number[] = [];
	for (let i: number = 0; i < accessor.count; i++) {
		for (let c: number = 0; c < components; c++) result.push(view.getFloat32(start + i * stride + c * 4, true));
	}
	return result;
}

function nodeTransform(node: GltfNode): JointTransform {
	return {
		position: (node.translation ?? [0, 0, 0]) as Vec3,
		rotation: (node.rotation ?? [0, 0, 0, 1]) as Quat,
	};
}

function buildAsset(json: GltfJson, bin: Uint8Array): GltfAsset {
	const skin = json.skins?.[0];
	if (!skin) throw new Error('glTF has no skin');
	const joint_nodes: Set<number> = new Set(skin.joints);
	const parent_of: Map<number, number> = new Map();
	json.nodes.forEach((node: GltfNode, i: number): void => (node.children ?? []).forEach((c: number): void => { parent_of.set(c, i); }));

	// depth first order from the scene roots so parents always precede their children
	const roots: number[] = json.scenes?.[json.scene ?? 0]?.nodes ?? [0];
	const order: number[] = [];
	const visit = (node: number): void => {
		if (joint_nodes.has(node)) order.push(node);
		(json.nodes[node].children ?? []).forEach(visit);
	};
	roots.forEach(visit);

	const joint_index: Map<number, number> = new Map(order.map((node: number, i: number): [number, number] => [node, i]));
	const names: string[] = order.map((node: number): string => json.nodes[node].name ?? `joint_${node}`);
	const parents: number[] = [];
	const bind: JointTransform[] = [];
	for (const node of order) {
		// non-joint ancestors (armature nodes) are folded into the transform of the first joint below them
		let transform: JointTransform = nodeTransform(json.nodes[node]);
		let ancestor: number | undefined = parent_of.get(node);
		while (ancestor !== undefined && !joint_index.has(ancestor)) {
			transform = composeTransforms(nodeTransform(json.nodes[ancestor]), transform);
			ancestor = parent_of.get(ancestor);
		}
		parents.push(ancestor === undefined ? -1 : (joint_index.get(ancestor) as number));
		bind.push({ position: [...transform.position] as Vec3, rotation: quatNormalize([...transform.rotation] as Quat) });
	}
	const skeleton: Skeleton = new Skeleton(names, parents, bind);

	const clips: SourceClip[] = (json.animations ?? []).map((animation, i: number): SourceClip => {
		const clip: SourceClip = { name: animation.name ?? `animation_${i}`, duration: 0, translation: new Map(), rotation: new Map() };
		for (const channel of animation.channels) {
			const joint: number | undefined = joint_index.get(channel.target.node);
			if (joint === undefined || (channel.target.path != 'translation' && channel.target.path != 'rotation')) continue;
			const sampler = animation.samplers[channel.sampler];
			const times: number[] = readAccessor(json, bin, sampler.input);
			let values: number[] = readAccessor(json, bin, sampler.output);
			const stride: 3 | 4 = channel.target.path == 'rotation' ? 4 : 3;
			if (sampler.interpolation == 'CUBICSPLINE') {
				// [in tangent, value, out tangent] per key: keep the value
				const picked: number[] = [];
				for (let k: number = 0; k < times.length; k++) picked.push(...values.slice((k * 3 + 1) * stride, (k * 3 + 2) * stride));
				values = picked;
			}
			const track: ClipTrack = { times, values, stride, step: sampler.interpolation == 'STEP' };
			(stride == 4 ? clip.rotation : clip.translation).set(joint, track);
			clip.duration = Math.max(clip.duration, times[times.length - 1] ?? 0);
		}
		return clip;
	});
	return { skeleton, clips };
}

function sampleTrack(track: ClipTrack, time: number): number[] {
	const { times, values, stride } = track;
	const count: number = times.length;
	const read = (k: number): number[] => values.slice(k * stride, (k + 1) * stride);
	if (time <= times[0]) return read(0);
	if (time >= times[count - 1]) return read(count - 1);
	let hi: number = 1;
	while (times[hi] < time) hi++;
	const lo: number = hi - 1;
	if (track.step) return read(lo);
	const t: number = (time - times[lo]) / (times[hi] - times[lo]);
	const a: number[] = read(lo);
	const b: number[] = read(hi);
	if (stride == 4) return quatSlerp(a as Quat, b as Quat, t);
	return lerp(a as Vec3, b as Vec3, t);
}

/** Evaluates a clip at a time (clamped to its length) as a pose of the asset's skeleton */
export function sampleClip(skeleton: Skeleton, clip: SourceClip, time: number): Pose {
	const local: JointTransform[] = skeleton.bind_local.map((t: JointTransform): JointTransform => ({
		position: [...t.position] as Vec3,
		rotation: [...t.rotation] as Quat,
	}));
	clip.translation.forEach((track: ClipTrack, joint: number): void => { local[joint].position = sampleTrack(track, time) as Vec3; });
	clip.rotation.forEach((track: ClipTrack, joint: number): void => { local[joint].rotation = quatNormalize(sampleTrack(track, time) as Quat); });
	return new Pose(skeleton, local);
}
