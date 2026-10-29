import type { CityState } from '../../core/city/state';
import type { Vec2 } from '../../core/types';
import type { CityDisplay } from '../display/city_display';
import { CanvasInput } from '../picker';
import type { CityHit, PointerHandler } from '../picker';
import type { RoadEditor, RoadPoint } from '../road_edit';
import type { CityStore } from '../store';
import type { RoundaboutModel } from './models';

const VALID: number = 0x7bdc8a;
const REACH: number = 14;

/** Click a road junction to turn it into a roundabout, like the roundabout tool in Cities: Skylines. */
export class RoundaboutTool implements PointerHandler {
	readonly tool: Tool;
	private readonly input: CanvasInput;
	private target: RoadPoint | null = null;
	private readonly onKey: (e: KeyboardEvent) => void;

	constructor(
		private readonly store: CityStore,
		private readonly display: CityDisplay,
		private readonly roads: RoadEditor,
		readonly model: RoundaboutModel,
		private readonly status: (message: string) => void,
		private readonly changed: () => void,
	) {
		this.tool = new Tool('citybuilder_roundabout', {
			name: 'Roundabout',
			description: 'Click a road junction to replace it with a roundabout',
			icon: 'sync',
			category: 'tools',
			modes: ['edit'],
			condition: (): boolean => !!Project && !!this.store.state,
			selectElements: false,
			transformerMode: 'hidden',
			cursor: 'crosshair',
			onSelect: (): void => {
				this.target = null;
				this.status('Hover a junction and click to build a roundabout. [ ] change its size.');
				this.changed();
			},
			onUnselect: (): void => {
				this.target = null;
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
			if (e.key === '[' || e.key === ']') {
				this.model.radius = Math.max(8, Math.min(120, Math.round(this.model.radius * (e.key === '[' ? 0.9 : 1 / 0.9))));
				this.drawPreview();
				this.changed();
			}
		};
		document.addEventListener('keydown', this.onKey);
	}

	get active(): boolean {
		return Toolbox.selected === this.tool;
	}

	private drawPreview(): void {
		const state: CityState | null = this.store.state;
		const target: RoadPoint | null = this.target;
		if (!state || !target) {
			this.display.cursor.hide();
		} else {
			const ring: Vec2[] = [];
			for (let i: number = 0; i < 72; i++) {
				const a: number = (i / 72) * Math.PI * 2;
				ring.push([target.x + Math.cos(a) * this.model.radius, target.z + Math.sin(a) * this.model.radius]);
			}
			this.display.cursor.path(state.terrain, ring, true, VALID);
		}
		Canvas.updateAll();
	}

	hover(hit: CityHit | null): void {
		const state: CityState | null = this.store.state;
		this.target = state && hit ? this.roads.nearest(state, hit.x, hit.z, REACH + this.model.radius * 0.25) : null;
		this.drawPreview();
	}

	down(hit: CityHit): void {
		const state: CityState | null = this.store.state;
		if (!state) return;
		const target: RoadPoint | null = this.roads.nearest(state, hit.x, hit.z, REACH + this.model.radius * 0.25);
		if (!target) {
			this.status('Click on a road junction.');
			return;
		}
		if (target.degree < 2) {
			this.status('A roundabout needs at least two roads meeting at the point.');
			return;
		}
		try {
			this.roads.roundabout(state, target, this.model.radius, this.model.profile, this.model.hand);
			this.status(`Built a roundabout with ${target.degree} exits.`);
		} catch (error) {
			this.status((error as Error).message);
		}
		this.target = null;
		this.display.cursor.hide();
		this.changed();
	}

	move(): void {}
	up(): void {}
	cancel(): void {}

	dispose(): void {
		this.input.dispose();
		document.removeEventListener('keydown', this.onKey);
		this.tool.delete();
	}
}
