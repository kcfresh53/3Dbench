import { NamingConvention } from './humanoid_types';

const SIDE_SUFFIX: RegExp = /\.(L|R)$/;

const GODOT_NAMES: Record<string, string> = {
	root: 'Root', hips: 'Hips', spine: 'Spine', chest: 'Chest', upper_chest: 'UpperChest', neck: 'Neck', head: 'Head',
	shoulder: 'Shoulder', upper_arm: 'UpperArm', lower_arm: 'LowerArm', hand: 'Hand',
	upper_leg: 'UpperLeg', lower_leg: 'LowerLeg', foot: 'Foot', toes: 'Toes',
	thumb_1: 'ThumbMetacarpal', thumb_2: 'ThumbProximal', thumb_3: 'ThumbDistal',
};
const UNITY_NAMES: Record<string, string> = {
	...GODOT_NAMES,
	root: 'Root',
	thumb_1: 'ThumbProximal', thumb_2: 'ThumbIntermediate', thumb_3: 'ThumbDistal',
};
const MIXAMO_NAMES: Record<string, string> = {
	root: 'Root', hips: 'Hips', spine: 'Spine', chest: 'Spine1', upper_chest: 'Spine2', neck: 'Neck', head: 'Head',
	shoulder: 'Shoulder', upper_arm: 'Arm', lower_arm: 'ForeArm', hand: 'Hand',
	upper_leg: 'UpLeg', lower_leg: 'Leg', foot: 'Foot', toes: 'ToeBase',
};
const FINGER_NAMES: Record<string, string> = { index: 'Index', middle: 'Middle', ring: 'Ring', pinky: 'Pinky', thumb: 'Thumb' };
const GODOT_FINGER_SEGMENTS: string[] = ['Proximal', 'Intermediate', 'Distal'];

/** Translates a canonical bone id such as 'upper_arm.L' into the name used by the chosen skeleton convention */
export function boneName(id: string, convention: NamingConvention): string {
	if (convention == 'simple') return id;
	const side_match: RegExpMatchArray | null = id.match(SIDE_SUFFIX);
	const side: string | null = side_match ? side_match[1] : null;
	const base: string = id.replace(SIDE_SUFFIX, '');
	const finger_match: RegExpMatchArray | null = base.match(/^(index|middle|ring|pinky|thumb)_(\d)$/);
	const side_word: string = side == 'L' ? 'Left' : 'Right';

	if (convention == 'mixamo') {
		const prefix: string = 'mixamorig:';
		if (finger_match) {
			return prefix + side_word + 'Hand' + FINGER_NAMES[finger_match[1]] + finger_match[2];
		}
		const name: string = MIXAMO_NAMES[base] ?? base;
		return prefix + (side ? side_word : '') + name;
	}

	const table: Record<string, string> = convention == 'unity' ? UNITY_NAMES : GODOT_NAMES;
	if (finger_match) {
		const finger: string = finger_match[1];
		const index: number = Number(finger_match[2]) - 1;
		const segment: string = finger == 'thumb' ? table['thumb_' + finger_match[2]] : GODOT_FINGER_SEGMENTS[index];
		return side_word + (finger == 'thumb' ? segment : FINGER_NAMES[finger] + segment);
	}
	const name: string = table[base] ?? base;
	return (side ? side_word : '') + name;
}
