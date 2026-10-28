import { addNode, addSegment, createNetwork } from '../../roadscape/src/core/network';
import type { RoadNetwork } from '../../roadscape/src/core/model';
import { CityState } from '../src/core/city/state';
import { roadSetFromNetwork } from '../src/core/roads/corridor';
import type { RoadSet } from '../src/core/roads/corridor';
import type { Vec3 } from '../src/core/types';

/** A flat 600 m square with a crossroad and a ring-less grid of streets. */
export function crossroadNetwork(arm: number = 160): RoadNetwork {
	const n: RoadNetwork = createNetwork({ defaultProfile: 'street' });
	const nodes: Array<[string, Vec3]> = [['c', [0, 0, 0]], ['n', [0, 0, -arm]], ['s', [0, 0, arm]], ['e', [arm, 0, 0]], ['w', [-arm, 0, 0]]];
	for (const [id, p] of nodes) addNode(n, id, p);
	for (const [a, b] of [['c', 'n'], ['c', 's'], ['c', 'e'], ['c', 'w']]) addSegment(n, a, b);
	return n;
}

export function roadsOf(network: RoadNetwork, state: CityState): RoadSet {
	return roadSetFromNetwork(network, { toCity: (p: Vec3): Vec3 => p, lengthScale: 1, sampleSpacing: 3, terrainHeight: (x: number, z: number): number => state.terrain.sample(x, z) });
}

export function flatCity(seed: number = 1): CityState {
	const state: CityState = CityState.create({ seed, cols: 129, rows: 129, cellSize: 6 });
	state.terrain.heights.fill(2);
	return state;
}
