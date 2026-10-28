import type { DistrictType } from '../district/types';
import { Rng, clamp, hashString, lerp } from '../math';
import { archetypeById } from './archetypes';
import type { Archetype } from './archetypes';
import type { BuildingSpec, RoofKind, RoofProp, ShapeKind } from './types';

export interface PlanContext {
	/** How built-up the city is, 0..1. */
	development: number;
	/** Land value at the lot, 0..1. */
	value: number;
	/** Number of distinct detail seeds per look. Fewer means more instancing and fewer prefabs. */
	variants: number;
	seed: number;
}

export interface Plan {
	spec: BuildingSpec;
	/** Footprint extent in metres, in the lot frame. */
	width: number;
	depth: number;
	/** Centre of the building in the lot frame; the front sits on the lot's front setback line. */
	offsetX: number;
	offsetZ: number;
}

function weightedPick<T>(rng: Rng, items: ReadonlyArray<[T, number]>): T {
	return items[rng.weighted(items.map((i: [T, number]): number => i[1]))][0];
}

/** Chooses an archetype whose storey range suits the target height. */
function chooseArchetype(district: DistrictType, floors: number, rng: Rng): Archetype | null {
	const options: Array<[Archetype, number]> = [];
	for (const entry of district.archetypes) {
		const a: Archetype | undefined = archetypeById(entry.id);
		if (a === undefined) continue;
		const reach: number = floors < a.floors[0] ? a.floors[0] - floors : floors > a.floors[1] ? floors - a.floors[1] : 0;
		options.push([a, entry.weight / (1 + reach * reach)]);
	}
	return options.length > 0 ? weightedPick(rng, options) : null;
}

/** Whether a lot is built on at the current development. The roll is stable, so growth only ever adds buildings. */
export function isBuilt(district: DistrictType, lotId: string, ctx: PlanContext): boolean {
	if (!district.buildable) return false;
	const roll: number = new Rng((hashString(lotId) ^ Math.imul(ctx.seed, 7919)) >>> 0).next();
	const chance: number = district.fill * clamp(ctx.development * (0.55 + 0.9 * ctx.value), 0, 1);
	return roll < chance;
}

/**
 * Decides what to build on a lot: archetype, footprint in bays, storeys, roof, palette and extras.
 * Returns null when the lot is too small for what the district builds.
 */
export function planBuilding(district: DistrictType, lotId: string, lotWidth: number, lotDepth: number, ctx: PlanContext): Plan | null {
	const rng: Rng = new Rng((hashString(`plan:${lotId}`) ^ Math.imul(ctx.seed, 40503)) >>> 0);
	const growth: number = clamp(0.1 + 0.45 * ctx.value + 0.45 * ctx.development + (rng.next() - 0.5) * 0.3, 0, 1);
	const target: number = Math.round(lerp(district.floors[0], district.floors[1], Math.pow(growth, 1.25)));
	const a: Archetype | null = chooseArchetype(district, target, rng);
	if (a === null) return null;

	const nxMax: number = Math.floor((lotWidth - 2 * a.sideSetback) / a.bay);
	const nzMax: number = Math.floor((lotDepth - a.frontSetback - a.backSetback) / a.bay);
	if (nxMax < 2 || nzMax < 2) return null;
	const size = (range: [number, number], max: number): number => {
		const lo: number = Math.min(range[0], max);
		const hi: number = Math.min(range[1], max);
		return clamp(Math.round(lerp(lo, hi, 0.35 + 0.65 * rng.next())), 2, max);
	};
	const nx: number = size(a.baysX, nxMax);
	const nz: number = size(a.baysZ, nzMax);

	const shape: ShapeKind = nx >= 4 && nz >= 4 ? weightedPick(rng, a.shapes) : 'rect';
	const roof: RoofKind = weightedPick(rng, a.roofs);
	const props: RoofProp[] = [];
	for (const [prop, chance] of a.props) if (rng.chance(chance)) props.push(prop);

	const palettes: number[] = district.palettes;
	const spec: BuildingSpec = {
		archetype: a.id,
		style: a.style,
		shape,
		roof,
		nx,
		nz,
		bay: a.bay,
		floors: clamp(target, a.floors[0], a.floors[1]),
		floorHeight: a.floorHeight,
		groundHeight: a.groundHeight,
		palette: palettes.length > 0 ? palettes[rng.int(0, palettes.length - 1)] : 0,
		seed: rng.int(0, Math.max(1, ctx.variants) - 1),
		shopfront: a.shopfront,
		awning: a.awning > 0 && rng.chance(a.awning),
		balconies: a.balconies > 0 && rng.chance(a.balconies),
		parapet: a.parapet,
		props,
		pitch: a.pitch[1] > 0 ? rng.range(a.pitch[0], a.pitch[1]) : 0,
	};
	// Quantise so nearby pitches share a prefab.
	spec.pitch = Math.round(spec.pitch / 4) * 4;

	const width: number = nx * a.bay;
	const depth: number = nz * a.bay;
	// Front sits at the setback line; the building is centred sideways.
	return { spec, width, depth, offsetX: 0, offsetZ: -lotDepth / 2 + a.frontSetback + depth / 2 };
}

/** Stable key: equal specs produce the same model. */
export function specKey(s: BuildingSpec): string {
	return [s.archetype, s.shape, s.roof, s.nx, s.nz, s.floors, s.palette, s.seed, s.shopfront ? 1 : 0, s.awning ? 1 : 0, s.balconies ? 1 : 0, s.pitch, s.props.join('+')].join('|');
}
