import { Vec3, Quat, quatMul, quatConjugate, quatAngle, distance } from '../core/math';
import type { Pose, JointTransform } from '../core/skeleton';
import type { SceneSkeleton } from './scene_skeleton';
import type { BakedTrack } from './animation_writer';

/** Local transform that a joint is compared against to decide whether it needs keyframes */
export type ReferenceLookup = (frame: number, joint: number) => JointTransform;

const ROTATION_EPSILON: number = 1e-4;

/**
 * Converts solved poses into keyframe tracks for the bones that differ from the reference
 * (the FK pose when baking, the rest pose when importing).
 */
export function buildTracks(
	scene: SceneSkeleton, animation: BBAnimation, times: number[], poses: Pose[], reference: ReferenceLookup, body_scale: number,
): BakedTrack[] {
	const tracks: BakedTrack[] = [];
	const position_epsilon: number = 1e-5 * body_scale;
	scene.joints.forEach((joint, index: number): void => {
		let rotation_changed: boolean = false;
		let position_changed: boolean = false;
		for (let frame: number = 0; frame < poses.length && !(rotation_changed && position_changed); frame++) {
			const solved: JointTransform = poses[frame].local[index];
			const base: JointTransform = reference(frame, index);
			if (!rotation_changed) {
				const delta: Quat = quatMul(solved.rotation, quatConjugate(base.rotation));
				rotation_changed = quatAngle(delta) > ROTATION_EPSILON;
			}
			if (!position_changed) position_changed = distance(solved.position, base.position) > position_epsilon;
		}
		if (!rotation_changed && !position_changed) return;
		const animator: BoneAnimator | null = animation.getBoneAnimator(joint.node);
		if (!animator) return;
		if (rotation_changed) {
			tracks.push({ animator, channel: 'rotation', times, values: poses.map((pose: Pose): Vec3 => scene.eulerDelta(index, pose.local[index].rotation)) });
		}
		if (position_changed) {
			tracks.push({ animator, channel: 'position', times, values: poses.map((pose: Pose): Vec3 => scene.positionDelta(index, pose.local[index].position)) });
		}
	});
	return tracks;
}
