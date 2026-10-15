import { Blockbench } from '../../../api';
import { Vue } from '../../../lib/libs';
import { Filesystem } from '../../../file_system';
import { readGlb, GltfAsset, sampleClip, SourceClip } from '../core/gltf_clip_reader';
import { RigBinding } from '../core/rig_binding';
import { createHumanoidRigConfig } from '../core/humanoid_rig_config';
import { mapHumanoidJoints, JointMapping } from '../core/joint_mapper';
import { retargetClip, RetargetedFrame } from '../core/retarget';
import type { IKRig } from '../core/ik_rig';
import type { JointTransform } from '../core/skeleton';
import { IKRigController } from './ik_rig_controller';
import { createGroundProvider } from './scene_providers';
import { buildTracks } from './track_builder';
import { existingKeyframes, writeTracks } from './animation_writer';
import type { IKRigProjectData } from './ik_rig_data';
import type { SceneSkeleton } from './scene_skeleton';

interface ClipChoice {
	name: string;
	duration: number;
	selected: boolean;
}

/** Lets the user pick a .glb with animations and retargets the chosen clips onto the project's rig */
export function importAnimationsFromGlb(): void {
	const controller: IKRigController | null = IKRigController.forProject();
	if (!controller?.data || !controller.ensureBuilt()) {
		Blockbench.showMessageBox({ title: 'Import Animations', message: 'Create an IK rig for your armature first (Animation > Create IK Rig). It defines how animations are retargeted onto the character.' });
		return;
	}
	Blockbench.import({
		resource_id: 'animation_library',
		extensions: ['glb'],
		type: 'glTF Binary',
		readtype: 'binary',
	}, (files: Filesystem.FileResult[]): void => {
		try {
			const asset: GltfAsset = readGlb(new Uint8Array(files[0].content as ArrayBuffer));
			if (!asset.clips.length) throw new Error('This file does not contain animations.');
			showClipDialog(controller, asset, files[0].name);
		} catch (error) {
			console.error(error);
			Blockbench.showMessageBox({ title: 'Import Animations', message: error instanceof Error ? error.message : 'The file could not be read.' });
		}
	});
}

function showClipDialog(controller: IKRigController, asset: GltfAsset, file_name: string): void {
	const mapping: JointMapping = mapHumanoidJoints(asset.skeleton.names, asset.skeleton.parents);
	const choices: ClipChoice[] = asset.clips.map((clip: SourceClip): ClipChoice => ({ name: clip.name, duration: clip.duration, selected: false }));
	interface ClipDialogVm {
		choices: ClipChoice[];
		filter: string;
		visible: ClipChoice[];
	}
	const state = Vue.observable({ choices, filter: '', fps: 30, missing: mapping.missing });

	const dialog: Dialog = new Dialog({
		id: 'ik_rig_import_animations',
		title: 'Import and Retarget Animations',
		width: 560,
		component: {
			data: (): typeof state => state,
			computed: {
				visible(this: ClipDialogVm): ClipChoice[] {
					const term: string = this.filter.toLowerCase();
					return this.choices.filter((choice: ClipChoice): boolean => choice.name.toLowerCase().includes(term));
				},
				count(this: ClipDialogVm): number {
					return this.choices.filter((choice: ClipChoice): boolean => choice.selected).length;
				},
			},
			methods: {
				setVisible(this: ClipDialogVm, value: boolean): void {
					this.visible.forEach((choice: ClipChoice): void => { choice.selected = value; });
				},
			},
			template: `
				<div>
					<p style="margin: 0 0 8px; color: var(--color-subtle_text);">{{ choices.length }} animations in ${file_name.replace(/[<>&"]/g, '')}.
						<span v-if="missing.length">Bones not found in the file: {{ missing.join(', ') }}.</span></p>
					<div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
						<input type="text" class="dark_bordered" style="flex: 1;" v-model="filter" placeholder="Filter">
						<button type="button" @click="setVisible(true)">Select shown</button>
						<button type="button" @click="setVisible(false)">Clear</button>
					</div>
					<ul style="max-height: 320px; overflow-y: auto; margin: 0; padding: 0; list-style: none;">
						<li v-for="choice in visible" :key="choice.name" style="display: flex; align-items: center; gap: 8px; padding: 2px 4px;">
							<input type="checkbox" v-model="choice.selected">
							<label style="flex: 1;">{{ choice.name }}</label>
							<span style="color: var(--color-subtle_text);">{{ choice.duration.toFixed(2) }} s</span>
						</li>
					</ul>
					<div style="display: flex; gap: 8px; align-items: center; margin-top: 10px;">
						<label>Frames per second</label>
						<input type="number" class="dark_bordered" style="width: 80px;" min="10" max="120" v-model.number="fps">
						<span style="flex: 1; text-align: right;">{{ count }} selected</span>
					</div>
				</div>`,
		},
		buttons: ['Import', 'dialog.cancel'],
		onConfirm(): void {
			const selected: SourceClip[] = asset.clips.filter((_: SourceClip, i: number): boolean => state.choices[i].selected);
			if (!selected.length) return;
			dialog.hide();
			importClips(controller, asset, mapping, selected, Math.min(120, Math.max(10, Math.round(state.fps))));
		},
	});
	dialog.show();
}

function importClips(controller: IKRigController, asset: GltfAsset, mapping: JointMapping, clips: SourceClip[], fps: number): void {
	if (!controller.ensureBuilt()) return;
	const rig: IKRig = controller.ik_rig as IKRig;
	const scene: SceneSkeleton = controller.skeleton as SceneSkeleton;
	const data: IKRigProjectData = controller.data as IKRigProjectData;

	const source_config = createHumanoidRigConfig(new Set(Object.keys(mapping.joints)), 'source');
	const source_binding: RigBinding = new RigBinding(asset.skeleton, source_config, mapping.joints);
	const providers = { ground: createGroundProvider(scene, data) };
	const rest: JointTransform[] = scene.skeleton.bind_local;

	const created: BBAnimation[] = [];
	Undo.initEdit({ animations: created });
	for (const clip of clips) {
		const frames: RetargetedFrame[] = retargetClip(
			{ binding: source_binding, sample: (time: number) => sampleClip(asset.skeleton, clip, time), duration: clip.duration },
			rig, { fps, providers },
		);
		const animation: BBAnimation = new BBAnimation({
			name: clip.name,
			loop: /loop/i.test(clip.name) ? 'loop' : 'once',
			length: clip.duration,
			snapping: fps,
		});
		Animator.animations.push(animation);
		animation.createUniqueName();
		const tracks = buildTracks(
			scene, animation, frames.map((f: RetargetedFrame): number => f.time), frames.map((f: RetargetedFrame) => f.pose),
			(_frame: number, joint: number): JointTransform => rest[joint], rig.binding.body_scale,
		);
		const keyframes: BBKeyframe[] = [];
		writeTracks(tracks, keyframes, { rotation_tolerance: 0.1, position_tolerance: 0.001 * rig.binding.body_scale });
		animation.setLength(clip.duration);
		created.push(animation);
	}
	Undo.finishEdit('Import retargeted animations', { animations: created });
	if (created.length) created[0].select();
	Blockbench.showQuickMessage(`Imported ${created.length} animation${created.length == 1 ? '' : 's'}`, 2000);
}
