import type { CityState } from '../core/city/state';
import { restoreAll, snapshotAll } from '../core/city/grow';
import type { FullSnapshot } from '../core/city/grow';
import { mergeSettings } from '../core/city/settings';
import type { CitySettings } from '../core/city/settings';

type Layer = 'heights' | 'paint' | 'districts';
type Data = Float32Array | Uint8Array;

interface LayerDiff {
	layer: Layer;
	from: number;
	before: Data;
	after: Data;
}

/** One undoable change to the city, stored as the smallest span of each array that differs. */
export interface CityEdit {
	projectId: string;
	label: string;
	layers: LayerDiff[];
	settings?: { before: string; after: string };
	/** Set when the edit changed the size of the map: complete copies from before and after. */
	resize?: { before: FullSnapshot; after: FullSnapshot };
}

interface Snapshot {
	heights: Float32Array;
	paint: Uint8Array;
	districts: Uint8Array;
	settings: string;
}

interface UndoEntry {
	citybuilder?: CityEdit;
}

function dataOf(state: CityState, layer: Layer): Data {
	return layer === 'heights' ? state.terrain.heights : layer === 'paint' ? state.paint.data : state.districts.grid.data;
}

function diffLayer(layer: Layer, before: Data, after: Data): LayerDiff | null {
	let first: number = -1;
	let last: number = -1;
	for (let i: number = 0; i < after.length; i++) {
		if (before[i] !== after[i]) {
			if (first < 0) first = i;
			last = i;
		}
	}
	if (first < 0) return null;
	return { layer, from: first, before: before.slice(first, last + 1), after: after.slice(first, last + 1) };
}

/**
 * Records edits made to a CityState and plays them back through Blockbench's own undo list,
 * so Ctrl+Z works across roads, meshes and the city alike.
 */
export class CityHistory {
	private snapshot: Snapshot | null = null;

	constructor(
		private readonly getState: () => CityState | null,
		private readonly onApplied: () => void,
	) {}

	/** Takes a copy of everything an edit could change. */
	begin(): void {
		const state: CityState | null = this.getState();
		if (!state) return;
		this.snapshot = {
			heights: state.terrain.heights.slice(),
			paint: state.paint.data.slice(),
			districts: state.districts.grid.data.slice(),
			settings: JSON.stringify(state.settings),
		};
	}

	/** Compares with the snapshot taken by `begin` and files the difference as one undo step. */
	commit(label: string, aspects?: {outliner:boolean; elements:Mesh[]; selection:boolean}): boolean {
		const state: CityState | null = this.getState();
		const snap: Snapshot | null = this.snapshot;
		this.snapshot = null;
		if (!state || !snap) return false;
		const layers: LayerDiff[] = [];
		for (const [layer, before] of [['heights', snap.heights], ['paint', snap.paint], ['districts', snap.districts]] as Array<[Layer, Data]>) {
			const diff: LayerDiff | null = diffLayer(layer, before, dataOf(state, layer));
			if (diff) layers.push(diff);
		}
		const now: string = JSON.stringify(state.settings);
		const settings: CityEdit['settings'] = now !== snap.settings ? { before: snap.settings, after: now } : undefined;
		if (layers.length === 0 && !settings && !aspects) return false;
		const edit: CityEdit = { projectId: Project?.uuid ?? '', label, layers, settings };
		if (!aspects) Undo.initEdit({ elements: [] } as never);
		Undo.finishEdit(label, (aspects ?? {elements:[]}) as never);
		const entry: UndoEntry | undefined = Undo.history[Undo.history.length - 1] as unknown as UndoEntry | undefined;
		if (entry) entry.citybuilder = edit;
		state.touch();
		return true;
	}

	/** Runs a change that resizes the map as one undo step, keeping complete copies from before and after. */
	editResize(label: string, change: () => void): void {
		const state: CityState | null = this.getState();
		if (!state) return;
		const before: FullSnapshot = snapshotAll(state);
		const settingsBefore: string = JSON.stringify(state.settings);
		change();
		const after: FullSnapshot = snapshotAll(state);
		const edit: CityEdit = { projectId: Project?.uuid ?? '', label, layers: [], settings: { before: settingsBefore, after: JSON.stringify(state.settings) }, resize: { before, after } };
		Undo.initEdit({ elements: [] } as never);
		Undo.finishEdit(label, { elements: [] } as never);
		const entry: UndoEntry | undefined = Undo.history[Undo.history.length - 1] as unknown as UndoEntry | undefined;
		if (entry) entry.citybuilder = edit;
		state.touch();
	}

	/** Forgets a half-finished edit (for example when a stroke is cancelled). */
	discard(): void {
		const state: CityState | null = this.getState();
		const snap: Snapshot | null = this.snapshot;
		this.snapshot = null;
		if (!state || !snap) return;
		state.terrain.heights.set(snap.heights);
		state.paint.data.set(snap.paint);
		state.districts.grid.data.set(snap.districts);
		state.touch();
	}

	/** Applies an edit forwards or backwards. */
	apply(edit: CityEdit, direction: 'undo' | 'redo'): void {
		const state: CityState | null = this.getState();
		if (!state || (Project?.uuid ?? '') !== edit.projectId) return;
		if (edit.resize) restoreAll(state, direction === 'undo' ? edit.resize.before : edit.resize.after);
		for (const diff of edit.layers) dataOf(state, diff.layer).set(direction === 'undo' ? diff.before : diff.after, diff.from);
		if (edit.settings) {
			state.settings = mergeSettings(JSON.parse(direction === 'undo' ? edit.settings.before : edit.settings.after) as Partial<CitySettings>);
		}
		state.districts.revision++;
		state.touch();
		this.onApplied();
	}

	/** Edits a value in `settings` as one undo step. */
	editSettings(label: string, change: (settings: CitySettings) => void): void {
		const state: CityState | null = this.getState();
		if (!state) return;
		this.begin();
		change(state.settings);
		this.commit(label);
	}
}

export function editOf(entry: unknown): CityEdit | undefined {
	return (entry as UndoEntry | undefined)?.citybuilder;
}
