import { composeCity } from '../core/city/compose';
import type { CityPlan } from '../core/city/compose';
import { deserializeCity, serializeCity } from '../core/city/serialize';
import { mergeSettings } from '../core/city/settings';
import type { CitySettings } from '../core/city/settings';
import { CityState } from '../core/city/state';
import { emptyRoadSet } from '../core/roads/corridor';
import type { RoadSet } from '../core/roads/corridor';
import { generateTerrain } from '../core/terrain/generate';
import type { TerrainPreset } from '../core/terrain/generate';
import { CityHistory } from './history';
import { PROJECT_KEY } from './ids';
import { RoadBridge } from './roads_bridge';
import { Signal } from './signal';

export type StoreChange = 'loaded' | 'edited' | 'composed' | 'cleared' | 'display';

type Stored = Record<string, string>;

/**
 * Owns the open project's city: the editable state, the road set read from Roadscape, and the
 * composed plan. Everything else (display, tools, panel) listens to `changed`.
 */
export class CityStore {
	state: CityState | null = null;
	plan: CityPlan | null = null;
	roads: RoadSet = emptyRoadSet();
	/** Bumps each time a new plan is ready. */
	planRevision: number = 0;
	/** Bumps on every edit, even before the plan is recomposed. */
	editRevision: number = 0;
	composeMs: number = 0;
	readonly changed: Signal<StoreChange> = new Signal<StoreChange>();
	readonly bridge: RoadBridge = new RoadBridge();
	readonly history: CityHistory;
	private timer: number | null = null;
	roadSignature: string = '';
	private poll: number | null = null;
	private roadEvents: Array<{ delete(): void }> = [];
	private flushTimer: number | null = null;
	private composing: boolean = false;

	constructor() {
		this.history = new CityHistory(
			(): CityState | null => this.state,
			(): void => this.edited(0),
		);
		// Road edits announce themselves through Blockbench events; the slow poll only catches anything that does not.
		this.poll = window.setInterval((): void => this.checkRoads(), 4000);
		this.roadEvents = (['finished_edit', 'undo', 'redo'] as const).map((name) => Blockbench.on(name, (): void => this.checkRoads()) as unknown as { delete(): void });
	}

	get unitsPerMeter(): number {
		return this.state?.settings.unitsPerMeter ?? 1;
	}

	has(): boolean {
		return this.state !== null;
	}

	/** Reads the city saved in the current project, if any. */
	load(): void {
		this.cancelTimers();
		this.plan = null;
		this.roadSignature = '';
		const raw: string = (typeof Project !== 'undefined' && Project ? (Project as unknown as Stored)[PROJECT_KEY] : '') ?? '';
		this.state = raw ? deserializeCity(raw) : null;
		this.changed.emit(this.state ? 'loaded' : 'cleared');
		if (this.state) this.recomposeNow();
	}

	/** Writes the city into the project shortly after the last change. */
	flushSoon(): void {
		if (this.flushTimer !== null) clearTimeout(this.flushTimer);
		this.flushTimer = window.setTimeout((): void => this.flush(), 300);
	}

	/** Writes the city into the project so it is saved with it. */
	flush(): void {
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		if (!this.state || typeof Project === 'undefined' || !Project) return;
		(Project as unknown as Stored)[PROJECT_KEY] = serializeCity(this.state);
	}

	create(partial: Partial<CitySettings>, preset: TerrainPreset): void {
		this.state = new CityState(mergeSettings(partial));
		generateTerrain(this.state.terrain, { preset, seed: this.state.settings.seed });
		if (Project) Project.saved = false;
		this.flush();
		this.changed.emit('loaded');
		this.recomposeNow();
	}

	remove(): void {
		this.cancelTimers();
		this.state = null;
		this.plan = null;
		if (typeof Project !== 'undefined' && Project) (Project as unknown as Stored)[PROJECT_KEY] = '';
		this.changed.emit('cleared');
	}

	/** Call after changing the state. Saves into the project at once, then recomposes after `delay` ms of quiet. */
	edited(delay: number = 250): void {
		this.editRevision++;
		if (typeof Project !== 'undefined' && Project) Project.saved = false;
		// Project properties are copied when the project is saved, so the document must be current soon after
		// every edit, but writing it on every brush dab is wasted work.
		this.flushSoon();
		this.changed.emit('edited');
		this.invalidate(delay);
	}

	/** For settings that only change how the city looks in the viewport (water colour, motion): saves, but does not recompose. */
	displayEdited(): void {
		if (typeof Project !== 'undefined' && Project) Project.saved = false;
		this.flushSoon();
		this.changed.emit('display');
	}

	invalidate(delay: number = 250): void {
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = window.setTimeout((): void => this.recomposeNow(), delay);
	}

	recomposeNow(): void {
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		const state: CityState | null = this.state;
		if (!state || this.composing) return;
		this.composing = true;
		try {
			const started: number = performance.now();
			this.roads = this.bridge.collect(state, state.settings.unitsPerMeter);
			this.roadSignature = this.bridge.signature(state.settings.unitsPerMeter);
			this.plan = composeCity(state, this.roads);
			this.composeMs = Math.round(performance.now() - started);
			this.planRevision++;
			this.changed.emit('composed');
		} finally {
			this.composing = false;
		}
	}

	private checkRoads(): void {
		const state: CityState | null = this.state;
		if (!state || this.timer !== null) return;
		const next: string = this.bridge.signature(state.settings.unitsPerMeter);
		if (next !== this.roadSignature) this.invalidate(150);
	}

	private cancelTimers(): void {
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
	}

	dispose(): void {
		this.flush();
		this.cancelTimers();
		if (this.poll !== null) clearInterval(this.poll);
		this.poll = null;
		for (const handle of this.roadEvents) handle.delete();
		this.roadEvents = [];
	}
}
