import type { CityState } from '../../core/city/state';
import { applyDab, newStroke, strokeTo } from '../../core/terrain/brush';
import type { StrokeState } from '../../core/terrain/brush';
import { paintSurface } from '../../core/terrain/surface_brush';
import type { GridRect } from '../../core/types';
import type { CityDisplay } from '../display/city_display';
import type { CityStore } from '../store';
import { CanvasInput } from '../picker';
import type { CityHit, PointerHandler } from '../picker';
import type { LandscapeModel } from './models';

const COLORS: Record<string, number> = { raise: 0x8fe38f, lower: 0xe38f8f, smooth: 0x8fc4e3, flatten: 0xe3d38f, level: 0xe3d38f, noise: 0xc48fe3, erode: 0xe3a88f, terrace: 0xe3d38f, surface: 0xffffff };

/** Sculpts the terrain with a brush and paints ground surfaces. */
export class LandscapeTool implements PointerHandler {
	readonly tool: Tool;
	private readonly input: CanvasInput;
	private stroke: StrokeState | null = null;
	private lastSurfaceX: number = 0;
	private lastSurfaceZ: number = 0;
	private readonly onKey: (e: KeyboardEvent) => void;

	constructor(
		private readonly store: CityStore,
		private readonly display: CityDisplay,
		readonly model: LandscapeModel,
		private readonly status: (message: string) => void,
		private readonly changed: () => void,
	) {
		this.tool = new Tool('citybuilder_landscape', {
			name: 'Landscape',
			description: 'Sculpt the terrain. Drag to raise; hold Ctrl to lower. [ and ] change the brush size',
			icon: 'landscape',
			category: 'tools',
			modes: ['edit'],
			condition: (): boolean => !!Project && !!this.store.state,
			selectElements: false,
			transformerMode: 'hidden',
			cursor: 'crosshair',
			onSelect: (): void => {
				this.status('Landscape: drag on the terrain. Ctrl inverts raise and lower. [ ] resize the brush.');
				this.changed();
			},
			onUnselect: (): void => {
				this.display.cursor.hide();
				this.cancel();
				this.changed();
			},
		} as never) as Tool;
		this.input = new CanvasInput(
			(): boolean => Toolbox.selected === this.tool && !!this.store.state,
			() => (this.store.state ? { hf: this.store.state.terrain, unitsPerMeter: this.store.unitsPerMeter, waterLevel: this.store.state.settings.waterLevel } : null),
			this,
		);
		this.onKey = (e: KeyboardEvent): void => {
			if (Toolbox.selected !== this.tool || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
			if (e.key === '[' || e.key === ']') {
				const factor: number = e.key === '[' ? 0.85 : 1 / 0.85;
				this.model.brush.radius = Math.max(2, Math.min(300, Math.round(this.model.brush.radius * factor * 10) / 10));
				this.changed();
			}
		};
		document.addEventListener('keydown', this.onKey);
	}

	get active(): boolean {
		return Toolbox.selected === this.tool;
	}

	hover(hit: CityHit | null): void {
		const state: CityState | null = this.store.state;
		if (!hit || !state) {
			this.display.cursor.hide();
			Canvas.updateAll();
			return;
		}
		this.display.cursor.brush(state.terrain, hit.x, hit.z, this.model.brush.radius, this.model.brush.shape, COLORS[this.model.mode] ?? 0xffffff);
		Canvas.updateAll();
	}

	down(hit: CityHit, event: PointerEvent): void {
		const state: CityState | null = this.store.state;
		if (!state) return;
		this.store.history.begin();
		this.stroke = newStroke();
		this.lastSurfaceX = Infinity;
		this.apply(state, hit, event, true);
	}

	move(hit: CityHit, event: PointerEvent): void {
		const state: CityState | null = this.store.state;
		if (!state || !this.stroke) return;
		this.hover(hit);
		this.apply(state, hit, event, false);
	}

	private apply(state: CityState, hit: CityHit, event: PointerEvent, first: boolean): void {
		const stroke: StrokeState = this.stroke as StrokeState;
		if (this.model.mode === 'surface') {
			const step: number = Math.max(1, this.model.brush.radius / 2);
			if (first || Math.hypot(hit.x - this.lastSurfaceX, hit.z - this.lastSurfaceZ) >= step) {
				this.lastSurfaceX = hit.x;
				this.lastSurfaceZ = hit.z;
				paintSurface(state.terrain, state.paint, hit.x, hit.z, this.model.brush.radius, this.model.surface, this.model.brush.shape);
			}
			this.display.liveDistricts();
			return;
		}
		const settings = { ...this.model.brush, mode: this.model.mode };
		const rect: GridRect | null = first ? applyDab(state.terrain, hit.x, hit.z, settings, stroke, event.ctrlKey || event.metaKey) : strokeTo(state.terrain, hit.x, hit.z, settings, stroke, event.ctrlKey || event.metaKey);
		if (rect) this.display.liveTerrain(state.terrain, rect);
	}

	up(): void {
		this.stroke = null;
		const label: string = this.model.mode === 'surface' ? 'Paint ground surface' : 'Sculpt terrain';
		if (this.store.history.commit(label)) this.store.edited(150);
	}

	cancel(): void {
		if (!this.stroke) return;
		this.stroke = null;
		this.store.history.discard();
		const state: CityState | null = this.store.state;
		if (state) this.display.liveTerrain(state.terrain, { c0: 0, r0: 0, c1: state.terrain.cols, r1: state.terrain.rows });
	}

	dispose(): void {
		this.input.dispose();
		document.removeEventListener('keydown', this.onKey);
		this.tool.delete();
	}
}
