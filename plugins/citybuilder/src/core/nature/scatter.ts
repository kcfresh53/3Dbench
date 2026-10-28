import type { ByteGrid } from '../grid';
import { surfaceName } from '../terrain/surfaces';
import { SpatialHash } from '../grid';
import { Rng, clamp, hashString } from '../math';
import { districtById } from '../district/library';
import type { DistrictMap } from '../district/map';
import type { DistrictType } from '../district/types';
import type { Obb } from '../geometry2d';
import { pointInObb } from '../geometry2d';
import type { RoadIndex } from '../roads/corridor';
import type { Heightfield } from '../terrain/heightfield';

export interface PlacedTree {
	x: number;
	y: number;
	z: number;
	yaw: number;
	scale: number;
	preset: string;
	variant: number;
	representation: 'model' | 'cross';
}

export interface ScatterInput {
	hf: Heightfield;
	surfaces?: ByteGrid;
	districts: DistrictMap;
	roads: RoadIndex;
	/** Footprints that trees must stay out of. */
	footprints: Obb[];
	waterLevel: number;
	seed: number;
	density: number;
	maxTrees: number;
	variants: number;
}

/**
 * Plants trees district by district at the density the district asks for. Positions come from the
 * cell grid with jitter, so the result is deterministic and edits only change nearby trees.
 */
export function scatterTrees(input: ScatterInput): PlacedTree[] {
	const { hf, districts } = input;
	const hash: SpatialHash<Obb> = new SpatialHash<Obb>(16);
	for (const f of input.footprints) {
		const reach: number = Math.hypot(f.hw, f.hd) + 1.5;
		hash.insert(f, f.cx - reach, f.cz - reach, f.cx + reach, f.cz + reach);
	}
	const trees: PlacedTree[] = [];
	for (let r: number = 0; r < hf.cellRows; r++) {
		for (let c: number = 0; c < hf.cellCols; c++) {
			const id: number = districts.grid.get(c, r);

			const district: DistrictType | undefined = districtById(id);
			const surface = surfaceName(input.surfaces?.get(c, r) ?? 1) ?? 'grass';
			if (['paved', 'rock', 'gravel'].includes(surface)) continue;
			const density = district?.treeDensity ?? (surface === 'forest' ? 1.2 : surface === 'sand' ? 0.12 : 0.3);
			if (density <= 0) continue;
			const rng: Rng = new Rng((hashString(`tree:${c}:${r}`) ^ Math.imul(input.seed, 2654435761)) >>> 0);
			const expected: number = (density * input.density * hf.cellSize * hf.cellSize) / 100;
			let count: number = Math.floor(expected);
			if (rng.chance(expected - count)) count++;
			for (let i: number = 0; i < count; i++) {
				const x: number = hf.worldX(c) + rng.next() * hf.cellSize;
				const z: number = hf.worldZ(r) + rng.next() * hf.cellSize;
				const y: number = hf.sample(x, z);
				if (y < input.waterLevel + 0.4 || hf.slope(x, z) > 0.7) continue;
				const clearance = input.roads.clearance(x, z, 30);
				if (clearance < 2) continue;
				let blocked: boolean = false;
				for (const f of hash.query(x - 1, z - 1, x + 1, z + 1)) {
					if (pointInObb(f, x, z, 1.5)) {
						blocked = true;
						break;
					}
				}
				if (blocked) continue;
				const species = surface === 'sand' ? [{preset: 'palm_realistic', weight: 1}]
					: surface === 'snow' ? [{preset: 'pine_realistic', weight: 1}]
					: surface === 'dirt' || surface === 'mud' ? [{preset: 'oak_realistic', weight: 3}, {preset: 'birch_realistic', weight: 2}]
					: district?.treeSpecies ?? [{preset: 'oak_realistic', weight: 3}, {preset: 'pine_realistic', weight: 1}, {preset: 'birch_realistic', weight: 2}];
				const weights = species.map(s => s.weight);
				trees.push({
					x,
					y,
					z,
					yaw: rng.next() * Math.PI * 2,
					scale: clamp(0.8 + rng.next() * 0.5, 0.6, 1.4),
					preset: (species[rng.weighted(weights)]?.preset ?? 'oak_realistic').replace('_stylized', '_realistic'),
					representation: clearance <= 24 ? 'model' : 'cross',
					variant: rng.int(0, Math.max(1, input.variants) - 1),
				});
			}
		}
	}
	if (trees.length <= input.maxTrees) return trees;
	// Keep an even subset rather than cutting off one side of the map.
	const stride: number = trees.length / input.maxTrees;
	const kept: PlacedTree[] = [];
	for (let i: number = 0; i < input.maxTrees; i++) kept.push(trees[Math.floor(i * stride)]);
	return kept;
}
