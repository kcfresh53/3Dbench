import { ByteGrid } from '../grid';
import { DistrictMap } from '../district/map';
import { fbm, smoothstep } from '../math';
import { Heightfield, MAX_VERTICES } from '../terrain/heightfield';
import type { IslandOptions } from '../terrain/island';
import type { CityState } from './state';

/** A complete copy of the layers whose size follows the terrain. */
export interface FullSnapshot {
	cols: number;
	rows: number;
	cellSize: number;
	heights: Float32Array;
	paint: Uint8Array;
	districts: Uint8Array;
}

export function snapshotAll(state: CityState): FullSnapshot {
	return {
		cols: state.terrain.cols,
		rows: state.terrain.rows,
		cellSize: state.terrain.cellSize,
		heights: state.terrain.heights.slice(),
		paint: state.paint.data.slice(),
		districts: state.districts.grid.data.slice(),
	};
}

/** Puts a snapshot back, replacing the terrain, paint and districts (their size may differ from now). */
export function restoreAll(state: CityState, snap: FullSnapshot): void {
	const revision: number = state.terrain.revision + 1;
	const districtRevision: number = state.districts.revision + 1;
	const terrain: Heightfield = new Heightfield({ cols: snap.cols, rows: snap.rows, cellSize: snap.cellSize }, snap.heights.slice());
	terrain.revision = revision;
	state.terrain = terrain;
	state.paint = ByteGrid.from(terrain.cellCols, terrain.cellRows, snap.paint);
	state.districts = new DistrictMap(terrain, ByteGrid.from(terrain.cellCols, terrain.cellRows, snap.districts));
	state.districts.revision = districtRevision;
	state.settings.cols = terrain.cols;
	state.settings.rows = terrain.rows;
	state.touch();
}

/**
 * Adds a margin of new ground around the whole map and slopes it into the sea, so the island forms
 * outside the existing map and nothing already built (roads, lots, zoning, sculpting) is lowered.
 * World coordinates of the existing ground do not change. Returns the margin added, in vertices per side.
 */
export function growIsland(state: CityState, options: IslandOptions): number {
	const old: Heightfield = state.terrain;
	const wanted: number = Math.ceil((Math.max(0.05, Math.min(0.7, options.width)) * Math.min(old.width, old.depth)) / 2 / old.cellSize);
	const room: number = Math.floor((MAX_VERTICES - Math.max(old.cols, old.rows)) / 2);
	const pad: number = Math.max(0, Math.min(wanted, room));
	if (pad < 2) return 0;
	const terrain: Heightfield = new Heightfield({ cols: old.cols + pad * 2, rows: old.rows + pad * 2, cellSize: old.cellSize });
	const floor: number = state.settings.waterLevel - Math.max(0.5, options.depth);
	const span: number = pad * old.cellSize;
	for (let r: number = 0; r < terrain.rows; r++) {
		for (let c: number = 0; c < terrain.cols; c++) {
			const oc: number = c - pad;
			const or: number = r - pad;
			const edge: number = old.get(oc, or);
			// Distance outside the old map: zero over it, so the existing ground is copied exactly.
			const dx: number = Math.max(0, -oc, oc - (old.cols - 1));
			const dz: number = Math.max(0, -or, or - (old.rows - 1));
			if (dx === 0 && dz === 0) {
				terrain.heights[terrain.index(c, r)] = old.heights[old.index(oc, or)];
				continue;
			}
			const t: number = Math.hypot(dx, dz) * old.cellSize / span;
			const x: number = terrain.worldX(c);
			const z: number = terrain.worldZ(r);
			const ragged: number = (fbm(x / 160, z / 160, options.seed, 4) - 0.5) * options.roughness * 0.9 * smoothstep(0, 0.35, t);
			const lift: number = (fbm(x / 90, z / 90, options.seed + 3, 3) - 0.5) * options.roughness * 3 * smoothstep(0, 0.3, t);
			const f: number = smoothstep(0, 0.85, t + ragged);
			const ground: number = edge + lift;
			terrain.heights[terrain.index(c, r)] = Math.min(ground, ground + (floor - ground) * f);
		}
	}
	terrain.revision = old.revision + 1;
	const paint: ByteGrid = new ByteGrid(terrain.cellCols, terrain.cellRows);
	const grid: ByteGrid = new ByteGrid(terrain.cellCols, terrain.cellRows);
	for (let r: number = 0; r < old.cellRows; r++) {
		for (let c: number = 0; c < old.cellCols; c++) {
			paint.set(c + pad, r + pad, state.paint.get(c, r));
			grid.set(c + pad, r + pad, state.districts.grid.get(c, r));
		}
	}
	const revision: number = state.districts.revision + 1;
	state.terrain = terrain;
	state.paint = paint;
	state.districts = new DistrictMap(terrain, grid);
	state.districts.revision = revision;
	state.settings.cols = terrain.cols;
	state.settings.rows = terrain.rows;
	state.touch();
	return pad;
}
