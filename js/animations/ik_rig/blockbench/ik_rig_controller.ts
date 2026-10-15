import { Blockbench } from '../../../api';
import { IKRig, EvaluateResult } from '../core/ik_rig';
import { RigBinding } from '../core/rig_binding';
import type { Pose } from '../core/skeleton';
import type { JointKey, FootLockRuleConfig, RuleConfig } from '../core/rig_types';
import { analyseContacts } from '../modifiers/contact_analysis';
import type { ContactTrack, RuleProviders } from '../modifiers/rule_context';
import { SceneSkeleton } from './scene_skeleton';
import { IKRigProjectData } from './ik_rig_data';
import { getRigData } from './ik_rig_project';
import { createGroundProvider, createHandleProvider, createAttachmentProvider } from './scene_providers';

declare global {
	interface BlockbenchEventMap {
		/** Fired while an animation frame is built, after the FK pass and before mesh deformation */
		animation_ik_pass: { animations: BBAnimation[], in_loop: boolean }
	}
}

export interface SolvedFrames {
	times: number[];
	fk: Pose[];
	solved: Pose[];
}

/**
 * Runtime of the project's IK rig inside the editor. Builds the rig from the stored data, runs it after the
 * FK animation pass of every preview frame, and can evaluate whole animations for baking.
 */
export class IKRigController {
	private static readonly instances: WeakMap<ModelProject, IKRigController> = new WeakMap();

	static forProject(project: ModelProject | null | undefined = Project): IKRigController | null {
		if (!project) return null;
		let controller: IKRigController | undefined = IKRigController.instances.get(project);
		if (!controller) {
			controller = new IKRigController(project);
			IKRigController.instances.set(project, controller);
		}
		return controller;
	}

	readonly project: ModelProject;
	private scene: SceneSkeleton | null = null;
	private rig: IKRig | null = null;
	private build_key: string = '';
	private contacts: { key: string; track: ContactTrack | null } | null = null;
	private revision: number = 0;
	private reported_error: boolean = false;

	private constructor(project: ModelProject) {
		this.project = project;
	}

	get data(): IKRigProjectData | null {
		return getRigData(this.project);
	}

	/** Drops caches after the model or animation changed */
	invalidate(): void {
		this.revision++;
		this.scene = null;
		this.rig = null;
		this.build_key = '';
		this.contacts = null;
		this.reported_error = false;
	}

	/** Call after editing rig settings: rules and solvers are rebuilt on the next frame */
	configChanged(): void {
		this.rig?.rebuild();
		this.contacts = null;
		this.revision++;
		if (Modes.animate) Animator.preview();
	}

	/** Resolves bones and builds the rig. Returns false when the rig can't be used. */
	ensureBuilt(): boolean {
		const data: IKRigProjectData | null = this.data;
		if (!data) return false;
		const key: string = JSON.stringify([data.roots, data.bindings]);
		if (this.scene && this.rig && key == this.build_key) return true;

		const roots: OutlinerNode[] = data.roots.map((uuid: string): OutlinerNode => OutlinerNode.uuids[uuid]).filter((node: OutlinerNode | undefined): boolean => !!node);
		const scene: SceneSkeleton | null = roots.length ? SceneSkeleton.collect(roots) : null;
		if (!scene) return false;
		const joints: Record<JointKey, number> = {};
		for (const [joint_key, uuid] of Object.entries(data.bindings)) {
			const index: number = scene.indexOfUuid(uuid);
			if (index >= 0) joints[joint_key] = index;
		}
		try {
			this.rig = new IKRig(new RigBinding(scene.skeleton, data.config, joints));
		} catch (error) {
			console.error('IK rig could not be built', error);
			return false;
		}
		this.scene = scene;
		this.build_key = key;
		return true;
	}

	get skeleton(): SceneSkeleton | null {
		return this.scene;
	}

	get ik_rig(): IKRig | null {
		return this.rig;
	}

	/** Runs the rig on the currently displayed pose (called every preview frame) */
	previewPass(): void {
		const data: IKRigProjectData | null = this.data;
		if (!data || !data.enabled || !this.ensureBuilt()) return;
		const scene: SceneSkeleton = this.scene as SceneSkeleton;
		const rig: IKRig = this.rig as IKRig;
		const animation: BBAnimation | null = BBAnimation.selected;
		const time: number = Timeline.time;
		try {
			// analysing contacts samples other frames, so it has to happen before the current pose is read
			const contacts: ContactTrack | null = this.contactsFor(animation);
			const fk: Pose = scene.readAnimated();
			const result: EvaluateResult = rig.evaluate(fk, { time, providers: this.createProviders(animation, time, contacts) });
			scene.writeChanged(result.pose, fk);
		} catch (error) {
			if (!this.reported_error) console.error('IK rig evaluation failed', error);
			this.reported_error = true;
		}
	}

	createProviders(animation: BBAnimation | null, time: number, contacts: ContactTrack | null): RuleProviders {
		const data: IKRigProjectData = this.data as IKRigProjectData;
		const scene: SceneSkeleton = this.scene as SceneSkeleton;
		return {
			ground: createGroundProvider(scene, data),
			handles: createHandleProvider(scene, data, animation, time),
			attachments: createAttachmentProvider(scene),
			contacts,
		};
	}

	/** Pose of the rig bones with only the FK animation applied at a time. Changes the displayed scene. */
	sampleFk(animation: BBAnimation, time: number): Pose {
		const scene: SceneSkeleton = this.scene as SceneSkeleton;
		const data: IKRigProjectData = this.data as IKRigProjectData;
		Timeline.time = time;
		scene.resetToRest();
		const weight: number = animation.blend_weight ? Math.clamp(Animator.MolangParser.parse(animation.blend_weight), 0, Infinity) : 1;
		for (const joint of scene.joints) {
			Animator.resetLastValues();
			animation.animators[joint.node.uuid]?.displayFrame(weight);
		}
		// handles are animated null objects
		for (const uuid of Object.values(data.handles)) {
			const handle = OutlinerNode.uuids[uuid];
			if (!handle || !handle.mesh) continue;
			const mesh = handle.mesh as THREE.Object3D & { fix_position?: THREE.Vector3 };
			if (mesh.fix_position) mesh.position.copy(mesh.fix_position);
			Animator.resetLastValues();
			animation.animators[uuid]?.displayFrame(1);
		}
		return scene.readAnimated();
	}

	/** Runs fn and restores the scene and timeline afterwards */
	withSavedState<T>(fn: () => T): T {
		const scene: SceneSkeleton = this.scene as SceneSkeleton;
		const saved: Pose = scene.readAnimated();
		const time: number = Timeline.time;
		const handle_positions: [THREE.Object3D, THREE.Vector3][] = [];
		for (const uuid of Object.values((this.data as IKRigProjectData).handles)) {
			const mesh: THREE.Object3D | undefined = OutlinerNode.uuids[uuid]?.mesh;
			if (mesh) handle_positions.push([mesh, mesh.position.clone()]);
		}
		try {
			return fn();
		} finally {
			Timeline.time = time;
			scene.writeAll(saved);
			handle_positions.forEach(([mesh, position]: [THREE.Object3D, THREE.Vector3]): void => { mesh.position.copy(position); });
		}
	}

	/** Foot contacts of an animation, found by analysing it once. Null when foot locking is off. */
	contactsFor(animation: BBAnimation | null): ContactTrack | null {
		const data: IKRigProjectData | null = this.data;
		if (!animation || !data || !this.rig || !this.scene) return null;
		const rule: FootLockRuleConfig | undefined = data.config.rules.find(
			(r: RuleConfig): boolean => r.kind == 'foot_lock' && r.enabled && r.weight > 0,
		) as FootLockRuleConfig | undefined;
		if (!rule || animation.length <= 0) return null;
		const key: string = `${animation.uuid}:${this.revision}:${animation.length}:${JSON.stringify(rule)}`;
		if (this.contacts && this.contacts.key == key) return this.contacts.track;
		const rig: IKRig = this.rig;
		const track: ContactTrack = this.withSavedState((): ContactTrack => analyseContacts(rig.binding, rule, {
			sample: (time: number): Pose => this.sampleFk(animation, time),
			duration: animation.length,
			fps: Math.min(30, animation.snapping),
		}));
		this.contacts = { key, track };
		return track;
	}

	/** Evaluates the rig for every frame of an animation. The scene is restored afterwards. */
	solveAnimation(animation: BBAnimation): SolvedFrames | null {
		if (!this.ensureBuilt()) return null;
		const rig: IKRig = this.rig as IKRig;
		const fps: number = animation.snapping;
		const frame_count: number = Math.round(animation.length * fps) + 1;
		const contacts: ContactTrack | null = this.contactsFor(animation);
		return this.withSavedState((): SolvedFrames => {
			const frames: SolvedFrames = { times: [], fk: [], solved: [] };
			for (let k: number = 0; k < frame_count; k++) {
				const time: number = Math.min(animation.length, k / fps);
				const fk: Pose = this.sampleFk(animation, time);
				const result: EvaluateResult = rig.evaluate(fk, { time, providers: this.createProviders(animation, time, contacts) });
				frames.times.push(time);
				frames.fk.push(fk);
				frames.solved.push(result.pose);
			}
			return frames;
		});
	}
}

Blockbench.on('animation_ik_pass', (): void => {
	IKRigController.forProject()?.previewPass();
});
for (const event of ['finish_edit', 'undo', 'redo', 'select_project', 'load_project'] as const) {
	Blockbench.on(event, (): void => {
		IKRigController.forProject()?.invalidate();
	});
}
