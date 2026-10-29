import type { CityState } from '../../core/city/state';
import { redraw } from '../display/gl';
import type { CityDisplay } from '../display/city_display';
import { CanvasInput } from '../picker';
import type { CityHit, PointerHandler } from '../picker';
import type { RoadEditor, RoadSpot } from '../road_edit';
import type { CityStore } from '../store';
import type { RampModel } from './models';

const VALID: number = 0x7bdc8a;
const REACH: number = 18;

/**
 * Click beside a highway to branch an exit or entry ramp off it, like the ramp tools in Cities: Skylines.
 * The side of the road you click decides which side the ramp is on.
 */
export class RampTool implements PointerHandler {
	readonly tool: Tool;
	private readonly input: CanvasInput;
	private target: RoadSpot | null = null;

	constructor(
		private readonly store: CityStore,
		private readonly display: CityDisplay,
		private readonly roads: RoadEditor,
		readonly model: RampModel,
		private readonly status: (message: string) => void,
		private readonly changed: () => void,
	) {
		this.tool = new Tool('citybuilder_ramp', {
			name: 'Highway ramp',
			description: 'Click beside a road to add an exit or entry ramp on that side',
			icon: 'call_split',
			category: 'tools',
			modes: ['edit'],
			condition: (): boolean => !!Project && !!this.store.state,
			selectElements: false,
			transformerMode: 'hidden',
			cursor: 'crosshair',
			onSelect: (): void => {
				this.target = null;
				this.status('Click beside a road, on the side where the ramp should go.');
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
	}

	get active(): boolean {
		return Toolbox.selected === this.tool;
	}

	hover(hit: CityHit | null): void {
		const state: CityState | null = this.store.state;
		this.target = state && hit ? this.roads.nearestSpot(state, hit.x, hit.z, REACH + this.model.length * 0.2) : null;
		if (state && this.target) this.display.cursor.brush(state.terrain, this.target.x, this.target.z, 6, 'round', VALID);
		else this.display.cursor.hide();
		redraw();
	}

	down(hit: CityHit): void {
		const state: CityState | null = this.store.state;
		if (!state) return;
		const spot: RoadSpot | null = this.roads.nearestSpot(state, hit.x, hit.z, REACH + this.model.length * 0.2);
		if (!spot) {
			this.status('Click next to a road.');
			return;
		}
		try {
			this.roads.ramp(state, spot, this.model);
			this.status(`Added ${this.model.kind === 'exit' ? 'an exit' : 'an entry'} ramp on the ${spot.side} side.`);
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
		this.tool.delete();
	}
}
