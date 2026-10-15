import { Armature } from '../../../outliner/types/armature';
import { ArmatureBone } from '../../../outliner/types/armature_bone';
import type { Vec3 } from '../core/math';
import { RigBinding } from '../core/rig_binding';
import { createHumanoidRigConfig } from '../core/humanoid_rig_config';
import { mapHumanoidJoints, JointMapping } from '../core/joint_mapper';
import type { GoalConfig, IKRigConfig, JointKey } from '../core/rig_types';
import { SceneSkeleton } from './scene_skeleton';
import { createDefaultGround, IKRigProjectData } from './ik_rig_data';
import { getRigData, setRigData } from './ik_rig_project';
import { IKRigController } from './ik_rig_controller';

/** Roots of the skeleton to rig: the selected armature / bone / group, otherwise the first armature in the project */
export function findSkeletonRoots(): OutlinerNode[] {
	const selected: OutlinerNode | undefined = ArmatureBone.selected[0] ?? Group.first_selected ?? Armature.selected?.[0];
	if (selected) {
		let top: OutlinerNode = selected;
		while (top.parent instanceof OutlinerNode && (top.parent instanceof Armature || top.parent instanceof ArmatureBone || top.parent instanceof Group)) top = top.parent;
		return [top];
	}
	const armature: Armature | undefined = Armature.all[0];
	if (armature) return [armature];
	return Group.all.filter((group: Group): boolean => group.parent == 'root');
}

export interface SetupResult {
	ok: boolean;
	message: string;
}

/** Creates the default humanoid rig for the skeleton and its goal handles */
export function createRigFromScene(): SetupResult {
	const roots: OutlinerNode[] = findSkeletonRoots();
	const scene: SceneSkeleton | null = roots.length ? SceneSkeleton.collect(roots) : null;
	if (!scene) return { ok: false, message: 'No armature or bone hierarchy found. Select the armature that should get an IK rig.' };

	const mapping: JointMapping = mapHumanoidJoints(scene.skeleton.names, scene.skeleton.parents);
	const required: JointKey[] = ['pelvis', 'upper_leg_l', 'lower_leg_l', 'foot_l', 'upper_leg_r', 'lower_leg_r', 'foot_r'];
	const lacking: JointKey[] = required.filter((key: JointKey): boolean => !(key in mapping.joints));
	if (lacking.length) {
		return { ok: false, message: `Could not find these humanoid bones by name: ${lacking.join(', ')}. Rename them (for example thigh_l, calf_l, foot_l, pelvis) or use the humanoid generator.` };
	}

	const keys: Set<JointKey> = new Set(Object.keys(mapping.joints));
	const config: IKRigConfig = createHumanoidRigConfig(keys, `${roots[0].name} IK Rig`);
	const bindings: Record<JointKey, string> = {};
	for (const [key, index] of Object.entries(mapping.joints)) bindings[key] = scene.joints[index].node.uuid;

	const data: IKRigProjectData = {
		version: 1, enabled: true, config, bindings,
		roots: roots.map((node: OutlinerNode): string => node.uuid),
		handles: {}, handle_blend: 0.15, ground: createDefaultGround(),
	};

	const created: NullObject[] = [];
	Undo.initEdit({ ik_rig: true, outliner: true, elements: created, selection: true });
	const binding: RigBinding = new RigBinding(scene.skeleton, config, mapping.joints);
	for (const goal of config.goals) {
		if (goal.kind == 'chest') continue;
		const handle: NullObject = createHandle(scene, binding, goal);
		data.handles[goal.id] = handle.uuid;
		created.push(handle);
	}
	setRigData(Project, data);
	Undo.finishEdit('Create IK rig', { ik_rig: true, outliner: true, elements: created, selection: true });
	IKRigController.forProject()?.invalidate();
	if (Modes.animate) Animator.preview();
	return { ok: true, message: `IK rig created with ${config.goals.length} goals, ${config.solvers.length} solvers and ${config.rules.length} rules.` };
}

function createHandle(scene: SceneSkeleton, binding: RigBinding, goal: GoalConfig): NullObject {
	const effector: number = binding.joint(goal.effector);
	let rest: Vec3 = scene.skeleton.bind_world[effector].position;
	if (goal.mode == 'handle') {
		// look-at targets sit in front of the character
		const distance: number = binding.body_scale * 1.5;
		rest = [rest[0] + binding.forward[0] * distance, rest[1], rest[2] + binding.forward[2] * distance];
	}
	const world: THREE.Vector3 = scene.fromPoseSpace(rest);
	const handle: NullObject = new NullObject({ name: `ik_${goal.id}`, from: [world.x, world.y, world.z], export: false } as never);
	handle.addTo();
	handle.init();
	handle.createUniqueName();
	return handle;
}

/** Removes the rig and its handles */
export function deleteRig(): void {
	const data: IKRigProjectData | null = getRigData();
	if (!data) return;
	const handles: NullObject[] = Object.values(data.handles)
		.map((uuid: string): OutlinerNode => OutlinerNode.uuids[uuid])
		.filter((node: OutlinerNode | undefined): boolean => node instanceof NullObject) as NullObject[];
	Undo.initEdit({ ik_rig: true, outliner: true, elements: handles, selection: true });
	handles.forEach((handle: NullObject): void => { handle.remove(); });
	setRigData(Project, null);
	Undo.finishEdit('Delete IK rig', { ik_rig: true, outliner: true, elements: [], selection: true });
	IKRigController.forProject()?.invalidate();
	if (Modes.animate) Animator.preview();
}

/** Looks the humanoid bones up again (after renaming or adding bones) and drops goals whose bones are gone */
export function redetectBones(): SetupResult {
	const data: IKRigProjectData | null = getRigData();
	if (!data) return { ok: false, message: 'There is no IK rig in this project.' };
	const roots: OutlinerNode[] = data.roots.map((uuid: string): OutlinerNode => OutlinerNode.uuids[uuid]).filter((n: OutlinerNode | undefined): boolean => !!n);
	const scene: SceneSkeleton | null = SceneSkeleton.collect(roots);
	if (!scene) return { ok: false, message: 'The skeleton of the rig no longer exists.' };
	const mapping: JointMapping = mapHumanoidJoints(scene.skeleton.names, scene.skeleton.parents);
	const bindings: Record<JointKey, string> = {};
	for (const [key, index] of Object.entries(mapping.joints)) bindings[key] = scene.joints[index].node.uuid;
	Undo.initEdit({ ik_rig: true });
	data.bindings = bindings;
	Undo.finishEdit('Re-detect IK rig bones');
	IKRigController.forProject()?.invalidate();
	if (Modes.animate) Animator.preview();
	return { ok: true, message: `${Object.keys(bindings).length} bones bound.${mapping.missing.length ? ' Missing: ' + mapping.missing.join(', ') + '.' : ''}` };
}

/** Selects the handle null object of a goal, creating it when it doesn't exist */
export function selectHandle(goal_id: string): void {
	const data: IKRigProjectData | null = getRigData();
	const controller: IKRigController | null = IKRigController.forProject();
	if (!data || !controller || !controller.ensureBuilt()) return;
	let handle: OutlinerNode | undefined = OutlinerNode.uuids[data.handles[goal_id]];
	if (!(handle instanceof NullObject)) {
		const goal: GoalConfig | undefined = data.config.goals.find((g: GoalConfig): boolean => g.id == goal_id);
		const scene: SceneSkeleton = controller.skeleton as SceneSkeleton;
		if (!goal) return;
		const joints: Record<JointKey, number> = {};
		for (const [key, uuid] of Object.entries(data.bindings)) {
			const index: number = scene.indexOfUuid(uuid);
			if (index >= 0) joints[key] = index;
		}
		const created: NullObject[] = [];
		Undo.initEdit({ ik_rig: true, outliner: true, elements: created, selection: true });
		handle = createHandle(scene, new RigBinding(scene.skeleton, data.config, joints), goal);
		created.push(handle as NullObject);
		data.handles[goal_id] = handle.uuid;
		Undo.finishEdit('Create IK handle', { ik_rig: true, outliner: true, elements: created, selection: true });
	}
	(handle as NullObject).select();
}
