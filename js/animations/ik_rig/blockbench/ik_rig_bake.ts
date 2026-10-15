import type { RigBinding } from '../core/rig_binding';
import type { IKRig } from '../core/ik_rig';
import { IKRigController, SolvedFrames } from './ik_rig_controller';
import { buildTracks } from './track_builder';
import { existingKeyframes, writeTracks, BakedTrack } from './animation_writer';
import type { JointTransform } from '../core/skeleton';
import type { IKRigProjectData } from './ik_rig_data';

export interface BakeOptions {
	/** Largest error of the reduced rotation curves in degrees */
	rotation_tolerance: number;
	/** Largest error of reduced position curves as a fraction of the body scale */
	position_tolerance: number;
	disable_after: boolean;
}

export const DEFAULT_BAKE_OPTIONS: BakeOptions = { rotation_tolerance: 0.05, position_tolerance: 0.0005, disable_after: true };

/**
 * Writes the result of the IK rig into the bone keyframes of an animation so it plays back without the rig.
 * Returns the number of created keyframes, or -1 when there was nothing to bake.
 */
export function bakeRigIntoAnimation(animation: BBAnimation, options: BakeOptions = DEFAULT_BAKE_OPTIONS): number {
	const controller: IKRigController | null = IKRigController.forProject();
	const data: IKRigProjectData | null = controller?.data ?? null;
	if (!controller || !data || animation.length <= 0) return -1;
	const frames: SolvedFrames | null = controller.solveAnimation(animation);
	const scene = controller.skeleton;
	if (!frames || !scene) return -1;

	const binding: RigBinding = (controller.ik_rig as IKRig).binding;
	const tracks: BakedTrack[] = buildTracks(
		scene, animation, frames.times, frames.solved,
		(frame: number, joint: number): JointTransform => frames.fk[frame].local[joint], binding.body_scale,
	);
	if (!tracks.length) return 0;

	const keyframes: BBKeyframe[] = existingKeyframes(tracks);
	Undo.initEdit({ keyframes, ik_rig: true });
	const created: number = writeTracks(tracks, keyframes, {
		rotation_tolerance: options.rotation_tolerance,
		position_tolerance: options.position_tolerance * binding.body_scale,
	});
	if (options.disable_after) data.enabled = false;
	Undo.finishEdit('Bake IK rig');
	animation.setLength();
	Animator.preview();
	return created;
}
