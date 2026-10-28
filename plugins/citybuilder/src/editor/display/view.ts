import type { CityPlan } from '../../core/city/compose';
import type { CityState } from '../../core/city/state';

export interface ViewContext {
	state: CityState;
	plan: CityPlan;
}

/** One layer of the live city. The display owns the views and asks each to rebuild after composing. */
export interface View {
	readonly root: THREE.Object3D;
	rebuild(ctx: ViewContext): void;
	dispose(): void;
}
