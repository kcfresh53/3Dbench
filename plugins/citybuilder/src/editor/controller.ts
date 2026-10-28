import { addTreesToPackage } from './tree_export';
import type { CityStats } from '../core/city/stats';
import type { CitySettings } from '../core/city/settings';
import { DEFAULT_CITY_SETTINGS } from '../core/city/settings';
import { DISTRICT_TYPES } from '../core/district/library';
import { buildGamePackage } from '../core/gameready/package';
import type { PackageReport } from '../core/gameready/package';
import { offsetAll, smoothAll } from '../core/terrain/brush';
import { generateTerrain, TERRAIN_PRESETS } from '../core/terrain/generate';
import type { TerrainPreset } from '../core/terrain/generate';
import { SURFACES, SURFACE_COLORS, SURFACE_LABELS, surfaceId } from '../core/terrain/surfaces';
import { bakeCity } from './bake';
import { CityDisplay } from './display/city_display';
import type { DisplayOptions } from './display/city_display';
import { writePackage } from './files';
import { makeMeshesGameReady } from './game_ready_action';
import { Signal } from './signal';
import { CityStore } from './store';
import { DistrictTool } from './tools/district_tool';
import { LandscapeTool } from './tools/landscape_tool';
import { DEFAULT_DISTRICT, DEFAULT_LANDSCAPE } from './tools/models';
import type { DistrictMode, DistrictModel, LandscapeMode, LandscapeModel } from './tools/models';

export interface NewCityOptions {
	size: number;
	cellSize: number;
	preset: TerrainPreset;
	seed: number;
}

export interface PanelSnapshot {
	hasCity: boolean;
	busy: string;
	settings: CitySettings;
	landscape: LandscapeModel;
	district: DistrictModel;
	display: DisplayOptions;
	stats: CityStats | null;
	composeMs: number;
	activeTool: 'landscape' | 'zoning' | 'none';
	roadCount: number;
	hasRoadscape: boolean;
	report: PackageReport | null;
	extent: number;
}

type Bag = Record<string, unknown>;

/** Sets `object[a][b][c] = value` for the path "a.b.c". The panel addresses settings by path. */
function setPath(object: Bag, path: string, value: unknown): void {
	const parts: string[] = path.split('.');
	let node: Bag = object;
	for (let i: number = 0; i < parts.length - 1; i++) node = node[parts[i]] as Bag;
	node[parts[parts.length - 1]] = value;
}

/**
 * The one object the panel talks to. It owns the store, the live display and both tools, and offers
 * every command as a method so the interface stays a thin template.
 */
export class CityController {
	readonly store: CityStore = new CityStore();
	readonly display: CityDisplay = new CityDisplay(this.store);
	readonly landscape: LandscapeModel = { ...DEFAULT_LANDSCAPE, brush: { ...DEFAULT_LANDSCAPE.brush } };
	readonly district: DistrictModel = { ...DEFAULT_DISTRICT };
	readonly changed: Signal<void> = new Signal<void>();
	readonly landscapeTool: LandscapeTool;
	readonly districtTool: DistrictTool;
	readonly presets: Array<{ id: TerrainPreset; label: string }> = TERRAIN_PRESETS;
	readonly districts: Array<{ id: number; key: string; label: string; color: string; zone: string }> = DISTRICT_TYPES.filter((d) => d.buildable || d.zone === 'park' || d.zone === 'forest').map((d) => ({ id: d.id, key: d.key, label: d.label, color: d.color, zone: d.zone }));
	readonly surfaces: Array<{ id: number; label: string; color: string }> = SURFACES.map((name) => {
		const c: [number, number, number] = SURFACE_COLORS[name];
		return { id: surfaceId(name), label: SURFACE_LABELS[name], color: `rgb(${c[0]},${c[1]},${c[2]})` };
	});
	status: string = 'Create a city to start.';
	report: PackageReport | null = null;
	busy: string = '';
	private readonly unsubscribe: Array<() => void> = [];
	private readonly eventHandles: Array<{ delete(): void }> = [];

	constructor() {
		const status = (message: string): void => this.say(message);
		const refresh = (): void => this.changed.emit();
		this.landscapeTool = new LandscapeTool(this.store, this.display, this.landscape, status, refresh);
		this.districtTool = new DistrictTool(this.store, this.display, this.district, status, refresh);
		this.unsubscribe.push(
			this.store.changed.on((kind): void => {
				if (kind === 'composed' || kind === 'loaded' || kind === 'cleared') this.display.sync();
				this.changed.emit();
			}),
		);
		const reload = (): void => {
			window.setTimeout((): void => this.bindProject(), 0);
		};
		this.eventHandles.push(
			Blockbench.on('select_project', reload) as never,
			Blockbench.on('load_project', reload) as never,
			Blockbench.on('unselect_project', (): void => {
				this.store.flush();
				this.display.detach();
			}) as never,
			Blockbench.on('undo', (data: { entry: unknown }): void => this.replay(data.entry, 'undo')) as never,
			Blockbench.on('redo', (data: { entry: unknown }): void => this.replay(data.entry, 'redo')) as never,
		);
		this.bindProject();
	}

	private replay(entry: unknown, direction: 'undo' | 'redo'): void {
		const edit = (entry as { citybuilder?: Parameters<CityStore['history']['apply']>[0] }).citybuilder;
		if (edit) this.store.history.apply(edit, direction);
	}

	/** Loads the open project's city and shows it. */
	bindProject(): void {
		this.store.load();
		this.display.attach();
		this.changed.emit();
	}

	say(message: string): void {
		this.status = message;
		this.changed.emit();
	}

	/** Runs a command, catching errors into the status line. */
	async run(label: string, work: () => void | Promise<void>): Promise<void> {
		this.busy = label;
		this.changed.emit();
		await new Promise<void>((resolve): void => void window.setTimeout(resolve, 20));
		try {
			await work();
		} catch (error) {
			this.status = (error as Error).message;
			console.error('CityBuilder', error);
			Blockbench.showQuickMessage((error as Error).message, 4000);
		} finally {
			this.busy = '';
			this.changed.emit();
		}
	}

	// ---- city -------------------------------------------------------------------------------

	create(options: NewCityOptions): Promise<void> {
		return this.run('Creating the city', (): void => {
			const settings: Partial<CitySettings> = { ...DEFAULT_CITY_SETTINGS, cols: options.size, rows: options.size, cellSize: options.cellSize, seed: options.seed };
			this.store.create(settings, options.preset);
			this.say('City created. Draw roads with Roadscape, zone districts, and shape the land.');
		});
	}

	remove(): void {
		this.deselectTools();
		this.store.remove();
		this.say('City removed from this project.');
	}

	regenerate(preset: TerrainPreset, seed: number): void {
		const state = this.store.state;
		if (!state) return;
		this.store.history.begin();
		state.settings.seed = seed;
		generateTerrain(state.terrain, { preset, seed });
		if (this.store.history.commit('Generate terrain')) this.store.edited(50);
	}

	smoothTerrain(): void {
		const state = this.store.state;
		if (!state) return;
		this.store.history.begin();
		smoothAll(state.terrain, 2);
		if (this.store.history.commit('Smooth terrain')) this.store.edited(50);
	}

	raiseTerrain(amount: number): void {
		const state = this.store.state;
		if (!state) return;
		this.store.history.begin();
		offsetAll(state.terrain, amount);
		if (this.store.history.commit('Raise terrain')) this.store.edited(50);
	}

	/** Changes a setting by path (for example "gameReady.atlasSize") as one undo step. */
	setSetting(path: string, value: unknown): void {
		const state = this.store.state;
		if (!state) return;
		this.store.history.editSettings(`Change ${path}`, (settings: CitySettings): void => setPath(settings as unknown as Bag, path, value));
		this.store.edited(path === 'unitsPerMeter' ? 0 : 300);
		if (path === 'unitsPerMeter') this.display.sync();
	}

	// ---- display ----------------------------------------------------------------------------

	setDisplay(key: keyof DisplayOptions, value: boolean): void {
		this.display.setOption(key, value);
		this.changed.emit();
	}

	// ---- tools ------------------------------------------------------------------------------

	deselectTools(): void {
		if (this.landscapeTool.active || this.districtTool.active) (BarItems.move_tool as unknown as { select(): void }).select();
	}

	pickLandscape(mode: LandscapeMode): void {
		this.landscape.mode = mode;
		this.landscapeTool.tool.select();
		this.changed.emit();
	}

	setLandscape(path: string, value: unknown): void {
		setPath(this.landscape as unknown as Bag, path, value);
		this.changed.emit();
	}

	pickDistrictMode(mode: DistrictMode): void {
		this.district.mode = mode;
		this.districtTool.tool.select();
		this.say(this.districtTool.hint());
	}

	pickDistrictType(id: number): void {
		this.district.id = id;
		if (this.district.mode === 'erase') this.district.mode = 'brush';
		this.districtTool.tool.select();
		this.changed.emit();
	}

	setDistrict(path: string, value: unknown): void {
		setPath(this.district as unknown as Bag, path, value);
		this.changed.emit();
	}

	zoneAllRoads(): void {
		this.say(`Zoned ${this.districtTool.zoneAllRoads()} cells beside the roads.`);
	}

	clearZones(): void {
		this.districtTool.clearAll();
		this.say('All districts cleared.');
	}

	// ---- roads ------------------------------------------------------------------------------

	get hasRoadscape(): boolean {
		return !!(BarItems as Record<string, unknown>)['roadscape'];
	}

	drawRoads(): void {
		const action = (BarItems as Record<string, { trigger?(event: Event): void } | undefined>)['roadscape'];
		if (!action?.trigger) {
			this.say('Load the Roadscape plugin to draw roads.');
			return;
		}
		action.trigger(new Event('click'));
	}

	drape(): void {
		const state = this.store.state;
		if (!state) return;
		const moved: number = this.store.bridge.drapeOnTerrain(state, state.settings.unitsPerMeter, state.settings.conform.roadBed);
		this.say(moved > 0 ? `Moved ${moved} road points onto the terrain.` : 'There are no Roadscape roads in this project.');
		this.store.invalidate(100);
	}

	// ---- game ready -------------------------------------------------------------------------

	analyse(): Promise<void> {
		return this.run('Analysing the export', async (): Promise<void> => {
			const state = this.store.state;
			const plan = this.store.plan;
			if (!state || !plan) throw new Error('Create a city first.');
			const pkg = buildGamePackage(plan, state);
			await addTreesToPackage(pkg, plan.trees);
			this.report = pkg.report;
			this.say(`Export would hold ${this.report.prefabs} building meshes on a ${this.report.atlasSize}px atlas.`);
		});
	}

	exportPackage(): Promise<void> {
		return this.run('Exporting the game package', async (): Promise<void> => {
			const state = this.store.state;
			const plan = this.store.plan;
			if (!state || !plan) throw new Error('Create a city first.');
			const directory: string | undefined = Blockbench.pickDirectory({ title: 'Export the city to a folder', resource_id: 'city_export' } as never);
			if (!directory) {
				this.say('Export cancelled.');
				return;
			}
			const pkg = buildGamePackage(plan, state);
			await addTreesToPackage(pkg, plan.trees);
			const written: number = await writePackage(directory, pkg.files);
			this.report = pkg.report;
			this.say(`Exported ${written} files to ${directory}. Add city_loader.gd to a Godot 4 scene to build it.`);
		});
	}

	bake(): Promise<void> {
		return this.run('Baking the city to meshes', async (): Promise<void> => {
			const result = await bakeCity(this.store);
			this.say(`Baked ${result.meshes} meshes (${result.triangles.toLocaleString()} triangles, ${result.buildings} buildings).`);
		});
	}

	gameReadySelection(): Promise<void> {
		return this.run('Making meshes game ready', (): void => {
			const settings = this.store.state?.settings.gameReady ?? DEFAULT_CITY_SETTINGS.gameReady;
			const summary = makeMeshesGameReady(settings);
			if (summary.length === 0) throw new Error('The selection has no faces.');
			this.say(summary.map((s) => `${s.name}: ${s.before} → ${s.after.join(' / ')} triangles${s.hidden ? `, ${s.hidden} hidden faces removed` : ''}`).join('; '));
		});
	}

	// ---- panel ------------------------------------------------------------------------------

	snapshot(): PanelSnapshot {
		const state = this.store.state;
		const settings: CitySettings = JSON.parse(JSON.stringify(state?.settings ?? DEFAULT_CITY_SETTINGS)) as CitySettings;
		return {
			hasCity: state !== null,
			busy: this.busy,
			settings,
			landscape: JSON.parse(JSON.stringify(this.landscape)) as LandscapeModel,
			district: { ...this.district },
			display: { ...this.display.options },
			stats: this.store.plan?.stats ?? null,
			composeMs: this.store.composeMs,
			activeTool: this.landscapeTool.active ? 'landscape' : this.districtTool.active ? 'zoning' : 'none',
			roadCount: this.store.roads.corridors.length,
			hasRoadscape: this.hasRoadscape,
			report: this.report,
			extent: state ? Math.round(state.terrain.width) : 0,
		};
	}

	dispose(): void {
		for (const off of this.unsubscribe) off();
		for (const handle of this.eventHandles) handle.delete();
		this.landscapeTool.dispose();
		this.districtTool.dispose();
		this.store.dispose();
		this.display.dispose();
	}
}
