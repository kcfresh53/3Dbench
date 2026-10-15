import { Side, JointKey, sidedKey, humanoidJointKeys } from './rig_types';

const PART_TABLE: Record<string, string> = {
	root: 'root', rootbone: 'root',
	pelvis: 'pelvis', hips: 'pelvis', hip: 'pelvis',
	spine: 'spine', chest: 'spine', upperchest: 'spine', abdomen: 'spine', torso: 'spine',
	neck: 'neck', head: 'head',
	clavicle: 'clavicle', shoulder: 'clavicle',
	upperarm: 'upper_arm', arm: 'upper_arm', uparm: 'upper_arm',
	lowerarm: 'lower_arm', forearm: 'lower_arm',
	hand: 'hand',
	thigh: 'upper_leg', upleg: 'upper_leg', upperleg: 'upper_leg',
	calf: 'lower_leg', leg: 'lower_leg', lowerleg: 'lower_leg', shin: 'lower_leg',
	foot: 'foot',
	ball: 'toes', toe: 'toes', toes: 'toes', toebase: 'toes',
};

interface ParsedName {
	side: Side | null;
	part: string | null;
}

/** Splits a bone name of any common convention (Unreal, Mixamo, Godot, Unity, 3D Bench) into side and canonical part */
export function parseJointName(name: string): ParsedName {
	let text: string = name.toLowerCase().replace(/^.*[:|]/, '').replace(/^mixamorig_?/, '');
	let side: Side | null = null;
	const tokens: string[] = [];
	for (let token of text.split(/[_.\-\s]+/).filter((t: string): boolean => t.length > 0)) {
		if (token == 'l' || token == 'left') { side = 'l'; continue; }
		if (token == 'r' || token == 'right') { side = 'r'; continue; }
		const prefix: RegExpMatchArray | null = token.match(/^(left|right)(.+)$/);
		const suffix: RegExpMatchArray | null = token.match(/^(.+)(left|right)$/);
		if (prefix) { side = prefix[1] == 'left' ? 'l' : 'r'; token = prefix[2]; }
		else if (suffix) { side = suffix[2] == 'left' ? 'l' : 'r'; token = suffix[1]; }
		tokens.push(token);
	}
	text = tokens.join('').replace(/\d+/g, '');
	return { side, part: PART_TABLE[text] ?? null };
}

export interface JointMapping {
	joints: Record<JointKey, number>;
	/** Standard keys that no bone was found for (fingers are optional and never listed) */
	missing: JointKey[];
}

const FINGER_NAMES: Record<string, string> = { thumb: 'thumb', index: 'index', middle: 'middle', ring: 'ring', pinky: 'pinky', little: 'pinky' };
const FINGER_END_MARKERS: RegExp = /leaf|end|tip|nub/;

/** Key of a finger joint such as 'index_2_l' */
export function fingerKey(finger: string, segment: number, side: Side): JointKey {
	return `${finger}_${segment}_${side}`;
}

/**
 * Finds finger joints by name. Segments are numbered by their order in the hierarchy,
 * which works for every naming scheme (Proximal / 01 / 1 ...). Leaf joints are ignored.
 */
function mapFingers(names: string[], joints: Record<JointKey, number>, parents: number[]): void {
	const found: Map<string, number[]> = new Map();
	names.forEach((name: string, index: number): void => {
		const lower: string = name.toLowerCase();
		if (FINGER_END_MARKERS.test(lower)) return;
		const finger: string | undefined = Object.keys(FINGER_NAMES).find((f: string): boolean => lower.includes(f));
		if (!finger) return;
		let side: Side | null = parseJointName(name).side;
		for (let p: number = parents[index]; side === null && p >= 0; p = parents[p]) side = parseJointName(names[p]).side;
		if (!side) return;
		const group: string = `${FINGER_NAMES[finger]}|${side}`;
		if (!found.has(group)) found.set(group, []);
		(found.get(group) as number[]).push(index);
	});
	found.forEach((chain: number[], group: string): void => {
		const [finger, side] = group.split('|');
		chain.slice(0, 3).forEach((index: number, i: number): void => { joints[fingerKey(finger, i + 1, side as Side)] = index; });
	});
}

/**
 * Finds the humanoid joints in a skeleton by name. `parents` is needed to order spine joints and to ignore
 * duplicates deeper in the hierarchy (for example twist bones).
 */
export function mapHumanoidJoints(names: string[], parents: number[]): JointMapping {
	const joints: Record<JointKey, number> = {};
	const spines: number[] = [];
	names.forEach((name: string, index: number): void => {
		const { side, part } = parseJointName(name);
		if (!part) return;
		if (part == 'spine') { spines.push(index); return; }
		const sided: boolean = ['clavicle', 'upper_arm', 'lower_arm', 'hand', 'upper_leg', 'lower_leg', 'foot', 'toes'].includes(part);
		if (sided && !side) return;
		const key: JointKey = sided ? sidedKey(part, side as Side) : part;
		if (!(key in joints)) joints[key] = index;
	});

	mapFingers(names, joints, parents);

	// the spine can have any number of joints, keep first / middle / last as spine_1..3
	const chain: number[] = spines.filter((index: number): boolean => {
		const pelvis: number | undefined = joints['pelvis'];
		return pelvis === undefined || isBelow(parents, index, pelvis);
	});
	const picks: number[] = chain.length <= 3 ? chain : [chain[0], chain[Math.floor((chain.length - 1) / 2)], chain[chain.length - 1]];
	picks.forEach((index: number, i: number): void => { joints[`spine_${i + 1}`] = index; });

	return { joints, missing: humanoidJointKeys().filter((key: JointKey): boolean => !(key in joints)) };
}

function isBelow(parents: number[], joint: number, ancestor: number): boolean {
	let current: number = parents[joint];
	while (current >= 0) {
		if (current == ancestor) return true;
		current = parents[current];
	}
	return false;
}
