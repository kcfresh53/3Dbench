import { LightingView } from './lighting_view';
import { redraw, refreshShadows } from './gl';
import type { GridRect } from '../../core/types';
import type { Heightfield } from '../../core/terrain/heightfield';
import { CityStore } from '../store';
import { BuildingView } from './building_view';
import { CursorView } from './cursor_view';
import { LotView } from './lot_view';
import { TerrainView } from './terrain_view';
import { TreeView } from './tree_view';
import type { ViewContext } from './view';
import { WaterView } from './water_view';

export interface DisplayOptions {
	daylight: boolean;
	districts: boolean;
	lots: boolean;
	buildings: boolean;
	trees: boolean;
}

export const DEFAULT_DISPLAY: DisplayOptions = { daylight: true, districts: false, lots: false, buildings: true, trees: true };

/** The live 3D city: owns every view, attaches them to the open project and keeps them in sync with the store. */
export class CityDisplay {
	readonly root: THREE.Object3D = new THREE.Object3D();
	readonly options: DisplayOptions = { ...DEFAULT_DISPLAY };
	readonly terrain: TerrainView = new TerrainView();
	private readonly lighting = new LightingView();
	readonly cursor: CursorView = new CursorView();
	private readonly water: WaterView = new WaterView();
	private readonly buildings: BuildingView = new BuildingView();
	private readonly lots: LotView = new LotView();
	private readonly trees: TreeView;
	private attached: THREE.Object3D | null = null;
	private lastRevision: number = -1;

	constructor(private readonly store: CityStore) {
		this.trees = new TreeView();
		this.terrain.onAlbedo = (texture): void => this.water.setBackdrop(texture);
		this.root.name = 'CityBuilder live city';
		(this.root as unknown as { no_export: boolean }).no_export = true;
		this.root.add(this.lighting.root, this.terrain.root, this.water.root, this.lots.root, this.buildings.root, this.trees.root, this.cursor.root);
	}

	/** Puts the city into the open project's scene. */
	attach(): void {
		this.detach();
		const scene: THREE.Object3D | undefined = typeof Project !== 'undefined' ? (Project?.model_3d as THREE.Object3D | undefined) : undefined;
		if (!scene) return;
		scene.add(this.root);
		this.attached = scene;
		this.lastRevision = -1;
		this.sync();
	}

	detach(): void {
		this.lighting.dispose();
		this.attached?.remove(this.root);
		this.attached = null;
	}

	/** Rebuilds the views when the store has a newer plan than the one shown. */
	sync(): void {
		const state = this.store.state;
		const plan = this.store.plan;
		if (!state || !plan || !this.attached) {
			this.root.visible = false;
			this.lighting.dispose();
			this.lastRevision = -1;
			return;
		}
		this.root.visible = true;
		this.root.scale.setScalar(state.settings.unitsPerMeter);
		if (this.lastRevision !== this.store.planRevision) {
			this.lastRevision = this.store.planRevision;
			const ctx: ViewContext = { state, plan };
			this.lighting.rebuild(ctx);
			this.terrain.rebuild(ctx);
			this.water.rebuild(ctx);
			this.buildings.rebuild(ctx);
			this.trees.rebuild(ctx);
			this.lots.rebuild(ctx);
			refreshShadows();
		}
		this.applyOptions();
		redraw();
	}

	applyOptions(): void {
		const o: DisplayOptions = this.options;
		this.lighting.setEnabled(o.daylight);
		this.terrain.showOverlay(o.districts);
		this.lots.root.visible = o.lots;
		this.buildings.root.visible = o.buildings;
		this.trees.root.visible = o.trees;
	}

	/** Applies new water settings (colour, motion, visibility) without recomposing. */
	updateWater(): void {
		const state = this.store.state;
		if (state) this.water.configure(state.settings.water);
		redraw();
	}

	setOption(key: keyof DisplayOptions, value: boolean): void {
		this.options[key] = value;
		this.applyOptions();
		redraw();
	}

	/** Shows brush edits straight away, before the plan is recomposed. */
	liveTerrain(hf: Heightfield, rect: GridRect): void {
		this.terrain.liveEdit(hf, rect);
		redraw();
	}

	liveDistricts(): void {
		if (this.store.state) this.terrain.setDistricts(this.store.state.districts);
		redraw();
	}

	dispose(): void {
		this.detach();
		this.terrain.dispose();
		this.water.dispose();
		this.buildings.dispose();
		this.trees.dispose();
		this.lots.dispose();
		this.cursor.dispose();
	}
}
