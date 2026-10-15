import type { Vec3 } from '../core/math';
import { reduceTrack, unwrapAngles } from '../core/track_reduce';

export type TrackChannel = 'rotation' | 'position';

export interface BakedTrack {
	animator: BoneAnimator;
	channel: TrackChannel;
	times: number[];
	/** One value per time. Rotations are degrees (unwrapped), positions are scene units. */
	values: Vec3[];
}

export interface WriteOptions {
	rotation_tolerance: number;
	position_tolerance: number;
}

/** Keyframes that writeTracks will remove. Pass them to Undo.initEdit({ keyframes }) before writing. */
export function existingKeyframes(tracks: BakedTrack[]): BBKeyframe[] {
	const result: BBKeyframe[] = [];
	for (const track of tracks) {
		const channel_keys: BBKeyframe[] | undefined = (track.animator as unknown as Record<string, BBKeyframe[]>)[track.channel];
		if (channel_keys) result.push(...channel_keys);
	}
	return result;
}

/**
 * Replaces the keyframes of the given animator channels with the baked tracks. The `keyframes` list is
 * the one given to Undo.initEdit: it is emptied after the old keyframes were removed and then
 * receives the created ones. Returns the number of keyframes created.
 */
export function writeTracks(tracks: BakedTrack[], keyframes: BBKeyframe[], options: WriteOptions): number {
	for (const keyframe of existingKeyframes(tracks)) keyframe.remove();
	keyframes.length = 0;

	let created: number = 0;
	for (const track of tracks) {
		const values: number[][] = track.channel == 'rotation' ? unwrapAngles(track.values) : track.values;
		const tolerance: number = track.channel == 'rotation' ? options.rotation_tolerance : options.position_tolerance;
		for (const index of reduceTrack(track.times, values, tolerance)) {
			const value: number[] = values[index];
			const keyframe: BBKeyframe | undefined = track.animator.addKeyframe({
				channel: track.channel,
				time: track.times[index],
				interpolation: 'linear',
				data_points: [{ x: round(value[0]), y: round(value[1]), z: round(value[2]) }],
			} as never, undefined as never);
			if (keyframe) {
				keyframes.push(keyframe);
				created++;
			}
		}
		track.animator.addToTimeline();
	}
	return created;
}

function round(value: number): number {
	return Math.round(value * 1e4) / 1e4;
}
