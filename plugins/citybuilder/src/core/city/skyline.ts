import { addNode, addSegment } from '../../../../roadscape/src/core/network';
import type { RoadNetwork } from '../../../../roadscape/src/core/model';
import type { CityState } from './state';

/** Mixed districts for the river skyline starter. Existing painted cells are retained. */
export function zoneSkyline(state: CityState): void {
	const hf = state.terrain, grid = state.districts.grid;
	for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
		if (grid.get(c, r) !== 0) continue;
		const x = hf.worldX(c) + hf.cellSize / 2, z = hf.worldZ(r) + hf.cellSize / 2;
		const nx = x / Math.min(hf.width / 2,768), nz = z / Math.min(hf.depth / 2,768);
		const radius = Math.hypot(nx / .82, (nz - .08) / .69);
		// A wind farm occupies the open ridge; woods frame both sides and the riverbanks.
		if (nz < -.69 && nz > -.98 && nx > -.25 && nx < .48 && hf.slope(x,z) < .3) { grid.set(c,r,13); continue; }
		if ((Math.abs(nx) > .83 || nz < -1.5 || (nz < -.32 && nz > -.65)) && hf.sample(x,z) > state.settings.waterLevel + 1) { grid.set(c,r,14); continue; }
		if (radius > 1 || hf.sample(x, z) < state.settings.waterLevel + 1 || hf.slope(x, z) > .32) continue;
		const core = Math.hypot((nx + .07) / .42, (nz + .02) / .32);
		// The office cluster is behind the low-rise foreground in the default camera view.
		const id = core < 1 ? 6 : nz > .37 ? (Math.sin(x / 42) > .7 ? 4 : 1) : radius < .78 ? 3 : 2;
		grid.set(c, r, id);
	}
	state.districts.revision++;
}

/** A separate elevated orbital highway, editable like every other Roadscape segment. */
export function addSkylineRing(state: CityState, network: RoadNetwork): void {
	const unit = state.settings.unitsPerMeter;
	const scale = Math.min(state.terrain.width, state.terrain.depth, 1536) / 1536;
	for (let i=0;i<16;i++) {
		const angle=i*Math.PI/8, x=Math.cos(angle)*700*scale, z=(40+Math.sin(angle)*570)*scale;
		addNode(network,`skyline_ring_${i}`,[x*unit,(state.terrain.sample(x,z)+14)*unit,z*unit]);
	}
	for (let i=0;i<16;i++) addSegment(network,`skyline_ring_${i}`,`skyline_ring_${(i+1)%16}`,{profile:'highway',structure:'bridge',smooth:true});
}
