import type { LiningElement, LiningType, RoadProfile, SideElement, StripElement, StripType } from './model';
import { makeLining } from './lining_library';
import { makeStrip } from './strip_library';

export type SideName = 'left' | 'right' | 'both';

/** Deep copy; profiles are plain JSON so this is safe and cheap. */
export function cloneProfile(profile: RoadProfile): RoadProfile {
	return JSON.parse(JSON.stringify(profile)) as RoadProfile;
}

function nextId(profile: RoadProfile, side: 'left' | 'right'): string {
	const used: Set<string> = new Set([...profile.left, ...profile.right].map((e: SideElement): string => e.id));
	let n: number = profile[side].length;
	let id: string = `${profile.id}.${side[0]}${n}`;
	while (used.has(id)) id = `${profile.id}.${side[0]}${++n}`;
	return id;
}

function sides(name: SideName): Array<'left' | 'right'> {
	return name === 'both' ? ['left', 'right'] : [name];
}

function insert(list: SideElement[], element: SideElement, index: number | undefined): void {
	list.splice(index === undefined ? list.length : Math.max(0, Math.min(list.length, index)), 0, element);
}

export function addStrip(profile: RoadProfile, side: SideName, type: StripType, index?: number): RoadProfile {
	const next: RoadProfile = cloneProfile(profile);
	for (const s of sides(side)) insert(next[s], makeStrip(type, nextId(next, s)), index);
	return next;
}

export function addLining(profile: RoadProfile, side: SideName, type: LiningType, index?: number): RoadProfile {
	const next: RoadProfile = cloneProfile(profile);
	for (const s of sides(side)) insert(next[s], makeLining(type, nextId(next, s)), index);
	return next;
}

export function removeElement(profile: RoadProfile, side: 'left' | 'right', id: string): RoadProfile {
	const next: RoadProfile = cloneProfile(profile);
	next[side] = next[side].filter((e: SideElement): boolean => e.id !== id);
	return next;
}

export function moveElement(profile: RoadProfile, side: 'left' | 'right', id: string, delta: -1 | 1): RoadProfile {
	const next: RoadProfile = cloneProfile(profile);
	const list: SideElement[] = next[side];
	const from: number = list.findIndex((e: SideElement): boolean => e.id === id);
	const to: number = from + delta;
	if (from < 0 || to < 0 || to >= list.length) return next;
	[list[from], list[to]] = [list[to], list[from]];
	return next;
}

export function updateStrip(profile: RoadProfile, side: 'left' | 'right', id: string, patch: Partial<StripElement>): RoadProfile {
	const next: RoadProfile = cloneProfile(profile);
	next[side] = next[side].map((e: SideElement): SideElement => (e.kind === 'strip' && e.id === id ? { ...e, ...patch, kind: 'strip' } : e));
	return next;
}

export function updateLining(profile: RoadProfile, side: 'left' | 'right', id: string, patch: Partial<LiningElement>): RoadProfile {
	const next: RoadProfile = cloneProfile(profile);
	next[side] = next[side].map((e: SideElement): SideElement => (e.kind === 'lining' && e.id === id ? { ...e, ...patch, kind: 'lining' } : e));
	return next;
}

/** Copies one side onto the other with fresh ids so the road becomes symmetric. */
export function mirrorSide(profile: RoadProfile, from: 'left' | 'right'): RoadProfile {
	const next: RoadProfile = cloneProfile(profile);
	const target: 'left' | 'right' = from === 'left' ? 'right' : 'left';
	next[target] = [];
	for (const e of next[from]) {
		const copy: SideElement = JSON.parse(JSON.stringify(e)) as SideElement;
		copy.id = nextId(next, target);
		next[target].push(copy);
	}
	return next;
}

/** Turns a built-in profile into an editable project copy with its own id. */
export function forkProfile(profile: RoadProfile, id: string, name: string): RoadProfile {
	const next: RoadProfile = cloneProfile(profile);
	const rename = (e: SideElement, i: number, tag: string): SideElement => ({ ...e, id: `${id}.${tag}${i}` });
	next.id = id;
	next.name = name;
	next.builtin = false;
	next.left = next.left.map((e: SideElement, i: number): SideElement => rename(e, i, 'l'));
	next.right = next.right.map((e: SideElement, i: number): SideElement => rename(e, i, 'r'));
	return next;
}
