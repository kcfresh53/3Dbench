import type { CityState } from '../../core/city/state';
import type { RoadChange } from '../../core/roads/road_paint';
import { polygonRegion, rectRegion, strokeBounds, strokeRegion } from '../../core/roads/region';
import type { Vec2 } from '../../core/types';
import type { CityDisplay } from '../display/city_display';
import { CanvasInput } from '../picker';
import type { CityHit, PointerHandler } from '../picker';
import type { RoadEditor } from '../road_edit';
import type { CityStore } from '../store';
import type { RoadTypeModel } from './models';

const PAINT: number = 0xffd166;

/**
 * Paints where the road type changes: bridge, tunnel, open span, ground, or any road profile.
 * Roads are cut at the edges of the painted area so only the painted stretch changes.
 */
export class RoadTypeTool implements PointerHandler {
	readonly tool: Tool;
	private readonly input: CanvasInput;
	private stroke: Vec2[] = [];
	private start: CityHit | null = null;
	private polygon: Vec2[] = [];
	private dragging: boolean = false;
	private readonly onKey: (e: KeyboardEvent) => void;

	constructor(
		private readonly store: CityStore,
		private readonly display: CityDisplay,
		private readonly roads: RoadEditor,
		readonly model: RoadTypeModel,
		private readonly status: (message: string) => void,
		private readonly changed: () => void,
	) {
		this.tool = new Tool('citybuilder_road_type', {
			name: 'Road type',
			description: 'Paint where a road becomes a bridge, tunnel, or another road type',
			icon: 'alt_route',
			category: 'tools',
			modes: ['edit'],
			condition: (): boolean => !!Project && !!this.store.state,
			selectElements: false,
			transformerMode: 'hidden',
			cursor: 'crosshair',
			onSelect: (): void => {
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
				this.model.radius = Math.max(2, Math.min(200, Math.round(this.model.radius * (e.key === '[' ? 0.85 : 1 / 0.85))));
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
				return 'Drag along a road to change its type. [ ] resize the brush.';
			case 'rect':
				return 'Drag a rectangle; roads inside it change type.';
			case 'polygon':
				return 'Click corners; Enter or double-click applies, Esc cancels.';
		}
	}

	private reset(): void {
		this.stroke = [];
		this.start = null;
		this.polygon = [];
		this.dragging = false;
	}

	private change(): RoadChange {
		const change: RoadChange = {};
		if (this.model.profile) change.profile = this.model.profile;
		if (this.model.structure !== 'keep') change.structure = this.model.structure;
		return change;
	}

	private apply(label: string, region: (x: number, z: number) => boolean, bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
		const state: CityState | null = this.store.state;
		if (!state) return;
		const change: RoadChange = this.change();
		if (change.profile === undefined && change.structure === undefined) {
			this.status('Choose a road type or structure to paint first.');
			return;
		}
		try {
			const result = this.roads.paint(state, region, change, bounds);
			this.status(result.changed > 0 ? `${label}: changed ${result.changed} road piece${result.changed === 1 ? '' : 's'}${result.split > 0 ? `, cut ${result.split} road${result.split === 1 ? '' : 's'} at the edges` : ''}.` : 'No roads in that area needed changing.');
		} catch (error) {
			this.status((error as Error).message);
		}
	}

	hover(hit: CityHit | null): void {
		const state: CityState | null = this.store.state;
		if (!state) return;
		if (!hit) {
			this.display.cursor.hide();
		} else if (this.model.mode === 'brush') {
			this.display.cursor.brush(state.terrain, hit.x, hit.z, this.model.radius, 'round', PAINT);
		} else if (this.model.mode === 'polygon' && this.polygon.length > 0) {
			this.display.cursor.path(state.terrain, [...this.polygon, [hit.x, hit.z]], false, PAINT);
		} else {
			this.display.cursor.hide();
		}
		Canvas.updateAll();
	}

	down(hit: CityHit, event: PointerEvent): void {
		if (this.model.mode === 'polygon') {
			this.polygon.push([hit.x, hit.z]);
			if (event.detail >= 2 && this.polygon.length >= 3) this.finishPolygon();
			else this.hover(hit);
			return;
		}
		this.dragging = true;
		this.start = hit;
		this.stroke = [[hit.x, hit.z]];
	}

	move(hit: CityHit): void {
		const state: CityState | null = this.store.state;
		if (!state || !this.dragging || !this.start) return;
		if (this.model.mode === 'brush') {
			const last: Vec2 = this.stroke[this.stroke.length - 1];
			if (Math.hypot(hit.x - last[0], hit.z - last[1]) >= Math.max(1, this.model.radius / 4)) this.stroke.push([hit.x, hit.z]);
			this.display.cursor.path(state.terrain, this.stroke.length > 1 ? this.stroke : [[hit.x, hit.z], [hit.x + 0.01, hit.z]], false, PAINT);
		} else {
			this.display.cursor.rect(state.terrain, this.start.x, this.start.z, hit.x, hit.z, PAINT);
			this.stroke = [[this.start.x, this.start.z], [hit.x, hit.z]];
		}
		Canvas.updateAll();
	}

	up(): void {
		if (!this.dragging) return;
		this.dragging = false;
		const stroke: Vec2[] = this.stroke;
		this.display.cursor.hide();
		if (this.model.mode === 'brush' && stroke.length > 0) {
			this.apply('Road type', strokeRegion(stroke, this.model.radius), strokeBounds(stroke, this.model.radius));
		} else if (this.model.mode === 'rect' && this.start && stroke.length === 2) {
			this.apply('Road type', rectRegion(stroke[0][0], stroke[0][1], stroke[1][0], stroke[1][1]), strokeBounds(stroke, 0));
		}
		this.reset();
		Canvas.updateAll();
	}

	cancel(): void {
		this.reset();
		this.display.cursor.hide();
		Canvas.updateAll();
	}

	private finishPolygon(): void {
		if (this.polygon.length < 3) return;
		const polygon: Vec2[] = this.polygon;
		this.polygon = [];
		this.display.cursor.hide();
		this.apply('Road type', polygonRegion(polygon), strokeBounds(polygon, 0));
		Canvas.updateAll();
	}

	dispose(): void {
		this.input.dispose();
		document.removeEventListener('keydown', this.onKey);
		this.tool.delete();
	}
}
