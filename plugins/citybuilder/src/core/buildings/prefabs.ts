import { specKey } from './plan';
import { buildModel } from './massing';
import type { BuildingModel, BuildingSpec } from './types';

export interface Prefab {
	key: string;
	model: BuildingModel;
	/** Number of lots using this prefab. */
	uses: number;
}

/**
 * Shares one model between all lots with the same spec. Past the budget, a new spec falls back to the
 * closest existing prefab of the same archetype, which keeps game-ready output small.
 */
export class PrefabLibrary {
	private readonly byKey: Map<string, Prefab> = new Map<string, Prefab>();
	private readonly byArchetype: Map<string, Prefab[]> = new Map<string, Prefab[]>();

	constructor(public budget: number) {}

	get count(): number {
		return this.byKey.size;
	}

	all(): Prefab[] {
		return [...this.byKey.values()];
	}

	resolve(spec: BuildingSpec): Prefab {
		const key: string = specKey(spec);
		const hit: Prefab | undefined = this.byKey.get(key);
		if (hit !== undefined) {
			hit.uses++;
			return hit;
		}
		const family: Prefab[] = this.byArchetype.get(spec.archetype) ?? [];
		if (this.byKey.size >= this.budget && family.length > 0) {
			let best: Prefab = family[0];
			let bestScore: number = Infinity;
			for (const p of family) {
				const s: BuildingSpec = p.model.spec;
				const score: number = Math.abs(s.nx - spec.nx) * 4 + Math.abs(s.nz - spec.nz) * 4 + Math.abs(s.floors - spec.floors) * 2 + (s.palette === spec.palette ? 0 : 3) + (s.shape === spec.shape ? 0 : 3);
				if (score < bestScore) {
					bestScore = score;
					best = p;
				}
			}
			best.uses++;
			return best;
		}
		const prefab: Prefab = { key, model: buildModel(spec), uses: 1 };
		this.byKey.set(key, prefab);
		family.push(prefab);
		this.byArchetype.set(spec.archetype, family);
		return prefab;
	}
}
