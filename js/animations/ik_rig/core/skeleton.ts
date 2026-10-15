/**
 * Skeleton (static hierarchy + bind pose) and Pose (animated local transforms with cached world transforms).
 * No scale support: rigs are assumed to have unit scale on every joint.
 */
import { Vec3, Quat, add, sub, quatMul, quatConjugate, quatRotate, quatNormalize, quatClone } from './math';

export interface JointTransform {
	position: Vec3;
	rotation: Quat;
}

export function cloneTransform(t: JointTransform): JointTransform {
	return { position: [t.position[0], t.position[1], t.position[2]], rotation: quatClone(t.rotation) };
}

/** Composes parent * child */
export function composeTransforms(parent: JointTransform, child: JointTransform): JointTransform {
	return {
		position: add(parent.position, quatRotate(parent.rotation, child.position)),
		rotation: quatMul(parent.rotation, child.rotation),
	};
}

export class Skeleton {
	readonly names: string[];
	/** Parent index per joint, -1 for roots. Parents always come before their children. */
	readonly parents: number[];
	readonly bind_local: JointTransform[];
	readonly children: number[][];
	private readonly index_by_name: Map<string, number> = new Map();
	private bind_world_cache: JointTransform[] | null = null;

	constructor(names: string[], parents: number[], bind_local: JointTransform[]) {
		if (names.length != parents.length || names.length != bind_local.length) {
			throw new Error('Skeleton: names, parents and bind pose must have the same length');
		}
		this.names = names;
		this.parents = parents;
		this.bind_local = bind_local.map((t: JointTransform): JointTransform => ({ position: [...t.position] as Vec3, rotation: quatNormalize(t.rotation) }));
		this.children = names.map((): number[] => []);
		parents.forEach((parent: number, i: number): void => {
			if (parent >= i) throw new Error(`Skeleton: joint ${names[i]} must come after its parent`);
			if (parent >= 0) this.children[parent].push(i);
			this.index_by_name.set(names[i], i);
		});
	}

	get count(): number {
		return this.names.length;
	}

	indexOf(name: string): number {
		return this.index_by_name.get(name) ?? -1;
	}

	isDescendantOf(joint: number, ancestor: number): boolean {
		let current: number = this.parents[joint];
		while (current >= 0) {
			if (current == ancestor) return true;
			current = this.parents[current];
		}
		return false;
	}

	/** Joint indices from `root` down to `tip` (both included). Empty when tip is not a descendant of root. */
	chain(root: number, tip: number): number[] {
		const result: number[] = [];
		let current: number = tip;
		while (current >= 0) {
			result.push(current);
			if (current == root) return result.reverse();
			current = this.parents[current];
		}
		return [];
	}

	/** All joints below `joint` (not including it), parents first */
	descendants(joint: number): number[] {
		const result: number[] = [];
		const stack: number[] = [...this.children[joint]].reverse();
		while (stack.length) {
			const current: number = stack.pop() as number;
			result.push(current);
			for (let i: number = this.children[current].length - 1; i >= 0; i--) stack.push(this.children[current][i]);
		}
		return result;
	}

	get bind_world(): JointTransform[] {
		if (!this.bind_world_cache) {
			const world: JointTransform[] = [];
			for (let i: number = 0; i < this.count; i++) {
				const parent: number = this.parents[i];
				world.push(parent >= 0 ? composeTransforms(world[parent], this.bind_local[i]) : cloneTransform(this.bind_local[i]));
			}
			this.bind_world_cache = world;
		}
		return this.bind_world_cache;
	}
}

export class Pose {
	readonly skeleton: Skeleton;
	readonly local: JointTransform[];
	readonly world: JointTransform[];

	constructor(skeleton: Skeleton, local?: JointTransform[]) {
		this.skeleton = skeleton;
		this.local = (local ?? skeleton.bind_local).map(cloneTransform);
		this.world = this.local.map(cloneTransform);
		this.updateWorld();
	}

	clone(): Pose {
		return new Pose(this.skeleton, this.local);
	}

	copyFrom(other: Pose): void {
		for (let i: number = 0; i < this.local.length; i++) {
			this.local[i] = cloneTransform(other.local[i]);
			this.world[i] = cloneTransform(other.world[i]);
		}
	}

	/** Recomputes every world transform */
	updateWorld(): void {
		for (let i: number = 0; i < this.local.length; i++) this.updateJointWorld(i);
	}

	private updateJointWorld(i: number): void {
		const parent: number = this.skeleton.parents[i];
		this.world[i] = parent >= 0 ? composeTransforms(this.world[parent], this.local[i]) : cloneTransform(this.local[i]);
		this.world[i].rotation = quatNormalize(this.world[i].rotation);
	}

	/** Recomputes the world transform of `joint` and everything below it */
	updateSubtree(joint: number): void {
		this.updateJointWorld(joint);
		for (const child of this.skeleton.descendants(joint)) this.updateJointWorld(child);
	}

	worldPosition(joint: number): Vec3 {
		return this.world[joint].position;
	}

	worldRotation(joint: number): Quat {
		return this.world[joint].rotation;
	}

	parentWorldRotation(joint: number): Quat {
		const parent: number = this.skeleton.parents[joint];
		return parent >= 0 ? this.world[parent].rotation : [0, 0, 0, 1];
	}

	/** Sets the local rotation of a joint and refreshes the subtree */
	setLocalRotation(joint: number, rotation: Quat): void {
		this.local[joint].rotation = quatNormalize(rotation);
		this.updateSubtree(joint);
	}

	/** Sets the world rotation of a joint, children follow rigidly (positions rotate around the joint) */
	setWorldRotation(joint: number, rotation: Quat): void {
		const parent_rotation: Quat = this.parentWorldRotation(joint);
		this.setLocalRotation(joint, quatMul(quatConjugate(parent_rotation), rotation));
	}

	/** Rotates a joint by a world-space delta rotation around the joint's own position */
	rotateWorld(joint: number, delta: Quat): void {
		this.setWorldRotation(joint, quatMul(delta, this.world[joint].rotation));
	}

	/** Moves a joint (and its subtree) by a world-space offset by changing its local position */
	translateWorld(joint: number, offset: Vec3): void {
		const local_offset: Vec3 = quatRotate(quatConjugate(this.parentWorldRotation(joint)), offset);
		this.local[joint].position = add(this.local[joint].position, local_offset);
		this.updateSubtree(joint);
	}

	setWorldPosition(joint: number, position: Vec3): void {
		this.translateWorld(joint, sub(position, this.world[joint].position));
	}
}
