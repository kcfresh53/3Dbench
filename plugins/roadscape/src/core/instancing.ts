import type { MeshPart, PartFace, Vec3 } from './types';
import type { LiningElement } from './model';
import type { PartSet } from './part_set';
import { Rng, hashSeed } from './rng';

/** Where a prop stands and which way it faces. Local +X points `inward`, local +Z points along `forward`. */
export interface InstanceFrame {
	position: Vec3;
	forward: Vec3;
	inward: Vec3;
}

export interface PropGeometry {
	positions: Vec3[];
	faces: PartFace[];
	atlas: string;
}

/** Stamps a prop into a part: scale, spin about the vertical, then move to the frame. */
export function emitPropInstance(set: PartSet, partName: string, prop: PropGeometry, frame: InstanceFrame, yaw: number, sx: number, sy: number, sz: number): void {
	const part: MeshPart = set.part(partName, prop.atlas);
	const c: number = Math.cos(yaw);
	const s: number = Math.sin(yaw);
	const world: Vec3[] = prop.positions.map((p: Vec3): Vec3 => {
		const lx: number = (p[0] * c - p[2] * s) * sx;
		const lz: number = (p[0] * s + p[2] * c) * sz;
		return [
			frame.position[0] + frame.inward[0] * lx + frame.forward[0] * lz,
			frame.position[1] + p[1] * sy,
			frame.position[2] + frame.inward[2] * lx + frame.forward[2] * lz,
		];
	});
	set.append(part, world, prop.faces);
}

export interface Slot {
	index: number;
	distance: number;
	/** Random numbers in [-1, 1) for lateral and along-road variation. */
	lateral: number;
	along: number;
	yaw: number;
	scale: number;
	variant: number;
}

export interface SlotPlan {
	slots: Slot[];
	step: number;
}

/**
 * Chooses where props go along a stretch of road. Slots are evenly spread so rows end symmetrically,
 * and each slot's randomness depends only on the lining and segment, so edits elsewhere never shuffle it.
 * `keep` below 1 removes a stable subset of slots, which is how density and budget thinning work.
 */
export function planSlots(element: LiningElement, unit: number, segmentKey: string, sign: number, from: number, to: number, keep: number, fitLength: number, randomYaw: boolean): SlotPlan {
	const margin: number = element.endMargin * unit;
	const start: number = from + margin;
	const end: number = to - margin;
	const length: number = end - start;
	const spacing: number = (fitLength > 0 ? fitLength : element.spacing) * unit;
	if (length <= 0 || spacing <= 1e-6) return { slots: [], step: spacing };
	let count: number = Math.round(length / spacing);
	if (count < 1) count = length >= spacing * 0.5 ? 1 : 0;
	const step: number = count > 0 ? length / count : spacing;
	const probability: number = Math.min(1, element.density * keep);
	const slots: Slot[] = [];
	for (let i: number = 0; i < count; i++) {
		const rng: Rng = new Rng(hashSeed(`${element.seed}|${segmentKey}|${sign}|${i}`));
		const roll: number = rng.next();
		const lateral: number = rng.signed();
		const along: number = rng.signed();
		const yaw: number = randomYaw ? rng.next() * Math.PI * 2 : 0;
		const scale: number = rng.signed();
		const variant: number = rng.next();
		if (roll >= probability) continue;
		let distance: number = start + (i + 0.5) * step;
		if (element.stagger && sign > 0) distance += step / 2;
		distance += along * element.jitter * step * 0.35;
		if (distance < from + margin * 0.5 || distance > to - margin * 0.5) continue;
		slots.push({ index: i, distance, lateral, along, yaw, scale, variant });
	}
	return { slots, step };
}
