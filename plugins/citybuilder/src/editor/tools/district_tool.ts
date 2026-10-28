import type { CityState } from '../../core/city/state';
import { pointSegmentDistance } from '../../core/geometry2d';
import type { RoadCorridor } from '../../core/roads/corridor';
import type { Vec2 } from '../../core/types';
import type { CityDisplay } from '../display/city_display';
import { CanvasInput } from '../picker';
import type { CityHit, PointerHandler } from '../picker';
import type { CityStore } from '../store';
import type { DistrictModel } from './models';

const PAINT: number = 0xffffff;
const ERASE: number = 0xff6b6b;

/** Zones ground into districts: brush, rectangle, polygon, bucket fill, or along a clicked road. */
export class DistrictTool implements PointerHandler {
	readonly tool: Tool;
	private readonly input: CanvasInput;
	private start: CityHit | null = null;
	private last: CityHit | null = null;
	private polygon: Vec2[] = [];
	private dragging: boolean = false;
	private readonly onKey: (e: KeyboardEvent) => void;

	constructor(
		private readonly store: CityStore,
		private readonly display: CityDisplay,
		readonly model: DistrictModel,
		private readonly status: (message: string) => void,
		private readonly changed: () => void,
	) {
		this.tool = new Tool('citybuilder_district', {
			name: 'Zoning',
			description: 'Paint districts like zones in a city builder: brush, rectangle, polygon, fill or along a road',
			icon: 'grid_view',
			category: 'tools',
			modes: ['edit'],
			condition: (): boolean => !!Project && !!this.store.state,
			selectElements: false,
			transformerMode: 'hidden',
			cursor: 'crosshair',
			onSelect: (): void => {
				this.display.setOption('districts', true);
				this.reset();
				this.status(this.hint());
				this.changed();
			},
			onUnselect: (): void => {
				this.reset();
				this.display.cursor.hide();
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
			if (e.key === 'Enter') this.finishPolygon();
			else if (e.key === 'Escape') {
				this.reset();
				this.display.cursor.hide();
				Canvas.updateAll();
			} else if (e.key === '[' || e.key === ']') {
				this.model.radius = Math.max(4, Math.min(300, Math.round(this.model.radius * (e.key === '[' ? 0.85 : 1 / 0.85))));
				this.changed();
			}
		};
		document.addEventListener('keydown', this.onKey);
	}

	get active(): boolean {
		return Toolbox.selected === this.tool;
	}

	hint(): string {
		switch (this.model.mode) {
			case 'brush':
			case 'erase':
				return 'Drag to paint the district. [ ] resize the brush.';
			case 'rect':
				return 'Drag a rectangle to zone it.';
			case 'polygon':
				return 'Click corners; Enter or double-click closes the area, Esc cancels.';
			case 'fill':
				return 'Click to fill the connected area of the same district.';
			case 'road':
				return 'Click a road to zone both of its sides to the chosen depth.';
		}
	}

	private get paintId(): number {
		return this.model.mode === 'erase' ? 0 : this.model.id;
	}

	private reset(): void {
		this.start = null;
		this.last = null;
		this.polygon = [];
		this.dragging = false;
	}

	hover(hit: CityHit | null): void {
		const state: CityState | null = this.store.state;
		if (!state) return;
		if (!hit) {
			this.display.cursor.hide();
			Canvas.updateAll();
			return;
		}
		const m: DistrictModel = this.model;
		if (m.mode === 'brush' || m.mode === 'erase') this.display.cursor.brush(state.terrain, hit.x, hit.z, m.radius, m.shape, m.mode === 'erase' ? ERASE : PAINT);
		else if (m.mode === 'polygon' && this.polygon.length > 0) this.display.cursor.path(state.terrain, [...this.polygon, [hit.x, hit.z]], false, PAINT);
		else if (m.mode === 'fill' || m.mode === 'road') this.display.cursor.brush(state.terrain, hit.x, hit.z, 6, 'round', PAINT);
		else this.display.cursor.hide();
		Canvas.updateAll();
	}

	down(hit: CityHit, event: PointerEvent): void {
		const state: CityState | null = this.store.state;
		if (!state) return;
		const m: DistrictModel = this.model;
		this.dragging = true;
		this.start = hit;
		this.last = hit;
		if (m.mode === 'polygon') {
			this.dragging = false;
			this.polygon.push([hit.x, hit.z]);
			if (event.detail >= 2 && this.polygon.length >= 3) this.finishPolygon();
			else this.hover(hit);
			return;
		}
		this.store.history.begin();
		if (m.mode === 'brush' || m.mode === 'erase') {
			state.districts.paintBrush(hit.x, hit.z, m.radius, this.paintId, m.shape, m.onlyUnzoned && m.mode === 'brush' ? 0 : -1);
			this.display.liveDistricts();
		} else if (m.mode === 'fill') {
			state.districts.floodFill(hit.x, hit.z, this.model.id);
			this.display.liveDistricts();
		} else if (m.mode === 'road') {
			this.zoneRoad(state, hit);
			this.display.liveDistricts();
		}
	}

	move(hit: CityHit): void {
		const state: CityState | null = this.store.state;
		if (!state || !this.dragging || !this.start || !this.last) return;
		const m: DistrictModel = this.model;
		if (m.mode === 'brush' || m.mode === 'erase') {
			const gap: number = Math.hypot(hit.x - this.last.x, hit.z - this.last.z);
			const step: number = Math.max(1, m.radius / 2);
			const n: number = Math.max(1, Math.ceil(gap / step));
			for (let i: number = 1; i <= n; i++) {
				const t: number = i / n;
				state.districts.paintBrush(this.last.x + (hit.x - this.last.x) * t, this.last.z + (hit.z - this.last.z) * t, m.radius, this.paintId, m.shape, m.onlyUnzoned && m.mode === 'brush' ? 0 : -1);
			}
			this.last = hit;
			this.display.cursor.brush(state.terrain, hit.x, hit.z, m.radius, m.shape, m.mode === 'erase' ? ERASE : PAINT);
			this.display.liveDistricts();
		} else if (m.mode === 'rect') {
			this.display.cursor.rect(state.terrain, this.start.x, this.start.z, hit.x, hit.z, PAINT);
			this.last = hit;
			Canvas.updateAll();
		}
	}

	up(): void {
		const state: CityState | null = this.store.state;
		if (!state || !this.dragging) return;
		this.dragging = false;
		const m: DistrictModel = this.model;
		if (m.mode === 'rect' && this.start && this.last) {
			state.districts.paintRect(this.start.x, this.start.z, this.last.x, this.last.z, this.model.id);
			this.display.cursor.hide();
			this.display.liveDistricts();
		}
		const label: string = m.mode === 'erase' ? 'Clear district' : 'Zone district';
		if (this.store.history.commit(label)) this.store.edited(150);
		this.start = null;
		this.last = null;
	}

	cancel(): void {
		if (!this.dragging) return;
		this.reset();
		this.store.history.discard();
		this.display.liveDistricts();
	}

	private zoneRoad(state: CityState, hit: CityHit): void {
		let best: RoadCorridor | null = null;
		let bestDistance: number = 25;
		for (const road of this.store.roads.corridors) {
			if (road.structure !== 'ground') continue;
			for (let i: number = 0; i + 1 < road.points.length; i++) {
				const a = road.points[i];
				const b = road.points[i + 1];
				const d: number = pointSegmentDistance(hit.x, hit.z, a.x, a.z, b.x, b.z) - Math.max(road.leftExtent, road.rightExtent);
				if (d < bestDistance) {
					bestDistance = d;
					best = road;
				}
			}
		}
		if (!best) {
			this.status('No ground-level road here. Draw roads with Roadscape first.');
			return;
		}
		const cells: number = state.districts.paintAlongRoads([best], this.model.id, this.model.depth, this.model.onlyUnzoned);
		this.status(`Zoned ${cells} cells along the road.`);
	}

	/** Zones the ground beside every road at once. */
	zoneAllRoads(): number {
		const state: CityState | null = this.store.state;
		if (!state) return 0;
		this.store.history.begin();
		const cells: number = state.districts.paintAlongRoads(this.store.roads.corridors, this.model.id, this.model.depth, this.model.onlyUnzoned);
		this.display.liveDistricts();
		if (this.store.history.commit('Zone along all roads')) this.store.edited(150);
		return cells;
	}

	/** Clears every district. */
	clearAll(): void {
		const state: CityState | null = this.store.state;
		if (!state) return;
		this.store.history.begin();
		state.districts.clear();
		this.display.liveDistricts();
		if (this.store.history.commit('Clear all districts')) this.store.edited(150);
	}

	private finishPolygon(): void {
		const state: CityState | null = this.store.state;
		if (!state || this.polygon.length < 3) return;
		this.store.history.begin();
		state.districts.paintPolygon(this.polygon, this.model.id);
		this.polygon = [];
		this.display.cursor.hide();
		this.display.liveDistricts();
		if (this.store.history.commit('Zone polygon')) this.store.edited(150);
	}

	dispose(): void {
		this.input.dispose();
		document.removeEventListener('keydown', this.onKey);
		this.tool.delete();
	}
}
