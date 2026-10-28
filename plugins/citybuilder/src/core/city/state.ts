import { ByteGrid } from '../grid';
import { DistrictMap } from '../district/map';
import { generateTerrain } from '../terrain/generate';
import { Heightfield } from '../terrain/heightfield';
import { mergeSettings } from './settings';
import type { CitySettings } from './settings';

/** Everything the player edits by hand. Roads come from Roadscape; everything else is derived from this. */
export class CityState {
	settings: CitySettings;
	terrain: Heightfield;
	/** Painted surface overrides (0 = automatic). */
	paint: ByteGrid;
	districts: DistrictMap;
	/** Bumps on any change that needs the city recomposed. */
	revision: number = 0;

	constructor(settings: CitySettings, terrain?: Heightfield, paint?: ByteGrid, districts?: DistrictMap) {
		this.settings = settings;
		this.terrain = terrain ?? new Heightfield({ cols: settings.cols, rows: settings.rows, cellSize: settings.cellSize });
		this.paint = paint ?? new ByteGrid(this.terrain.cellCols, this.terrain.cellRows);
		this.districts = districts ?? new DistrictMap(this.terrain);
	}

	static create(partial?: Partial<CitySettings>): CityState {
		const settings: CitySettings = mergeSettings(partial);
		const state: CityState = new CityState(settings);
		generateTerrain(state.terrain, { preset: 'rolling', seed: settings.seed });
		return state;
	}

	touch(): void {
		this.revision++;
		this.terrain.touch();
	}
}
