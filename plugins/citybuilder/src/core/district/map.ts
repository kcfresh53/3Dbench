import { ByteGrid, SpatialHash } from '../grid';
import { pointInPolygon } from '../geometry2d';
import type { GridRect, Vec2 } from '../types';
import { Heightfield } from '../terrain/heightfield';
import type { RoadCorridor, RoadSample } from '../roads/corridor';
import { pointSegmentDistance } from '../geometry2d';
import { NO_DISTRICT } from './types';

interface RoadPiece {
	road: RoadCorridor;
	a: RoadSample;
	b: RoadSample;
}

export type PaintShape = 'round' | 'square';

/** Which district every terrain cell belongs to. 0 is unzoned. */
export class DistrictMap {
	readonly grid: ByteGrid;
	revision: number = 0;

	constructor(
		readonly hf: Heightfield,
		grid?: ByteGrid,
	) {
		this.grid = grid && grid.cols === hf.cellCols && grid.rows === hf.cellRows ? grid : new ByteGrid(hf.cellCols, hf.cellRows);
	}

	idAt(x: number, z: number): number {
		return this.grid.get(Math.floor(this.hf.colAt(x)), Math.floor(this.hf.rowAt(z)));
	}

	private cellCentre(c: number, r: number): Vec2 {
		return [this.hf.worldX(c) + this.hf.cellSize / 2, this.hf.worldZ(r) + this.hf.cellSize / 2];
	}

	private clampRect(c0: number, r0: number, c1: number, r1: number): GridRect {
		return {
			c0: Math.max(0, c0),
			r0: Math.max(0, r0),
			c1: Math.min(this.grid.cols - 1, c1),
			r1: Math.min(this.grid.rows - 1, r1),
		};
	}

	/** Paints a disc or square of cells. `only` restricts changes to cells currently holding that id (-1 for any). */
	paintBrush(x: number, z: number, radius: number, id: number, shape: PaintShape = 'round', only: number = -1): GridRect {
		const rect: GridRect = this.clampRect(
			Math.floor(this.hf.colAt(x - radius)),
			Math.floor(this.hf.rowAt(z - radius)),
			Math.ceil(this.hf.colAt(x + radius)),
			Math.ceil(this.hf.rowAt(z + radius)),
		);
		for (let r: number = rect.r0; r <= rect.r1; r++) {
			for (let c: number = rect.c0; c <= rect.c1; c++) {
				const [cx, cz] = this.cellCentre(c, r);
				const inside: boolean = shape === 'square' ? Math.abs(cx - x) <= radius && Math.abs(cz - z) <= radius : Math.hypot(cx - x, cz - z) <= radius;
				if (!inside) continue;
				if (only >= 0 && this.grid.get(c, r) !== only) continue;
				this.grid.set(c, r, id);
			}
		}
		this.revision++;
		return rect;
	}

	/** Fills the cells whose centres lie inside a world rectangle. */
	paintRect(x0: number, z0: number, x1: number, z1: number, id: number): GridRect {
		const rect: GridRect = this.clampRect(
			Math.floor(this.hf.colAt(Math.min(x0, x1))),
			Math.floor(this.hf.rowAt(Math.min(z0, z1))),
			Math.ceil(this.hf.colAt(Math.max(x0, x1))),
			Math.ceil(this.hf.rowAt(Math.max(z0, z1))),
		);
		for (let r: number = rect.r0; r <= rect.r1; r++) {
			for (let c: number = rect.c0; c <= rect.c1; c++) {
				const [cx, cz] = this.cellCentre(c, r);
				if (cx >= Math.min(x0, x1) && cx <= Math.max(x0, x1) && cz >= Math.min(z0, z1) && cz <= Math.max(z0, z1)) this.grid.set(c, r, id);
			}
		}
		this.revision++;
		return rect;
	}

	paintPolygon(polygon: Vec2[], id: number): GridRect {
		if (polygon.length < 3) return { c0: 0, r0: 0, c1: -1, r1: -1 };
		const xs: number[] = polygon.map((p: Vec2): number => p[0]);
		const zs: number[] = polygon.map((p: Vec2): number => p[1]);
		const rect: GridRect = this.clampRect(
			Math.floor(this.hf.colAt(Math.min(...xs))),
			Math.floor(this.hf.rowAt(Math.min(...zs))),
			Math.ceil(this.hf.colAt(Math.max(...xs))),
			Math.ceil(this.hf.rowAt(Math.max(...zs))),
		);
		for (let r: number = rect.r0; r <= rect.r1; r++) {
			for (let c: number = rect.c0; c <= rect.c1; c++) {
				const [cx, cz] = this.cellCentre(c, r);
				if (pointInPolygon(cx, cz, polygon)) this.grid.set(c, r, id);
			}
		}
		this.revision++;
		return rect;
	}

	/** Replaces the connected region of equal id around a cell. Returns how many cells changed. */
	floodFill(x: number, z: number, id: number, limit: number = 40000): number {
		const c0: number = Math.floor(this.hf.colAt(x));
		const r0: number = Math.floor(this.hf.rowAt(z));
		if (!this.grid.inside(c0, r0)) return 0;
		const target: number = this.grid.get(c0, r0);
		if (target === id) return 0;
		const stack: number[] = [c0, r0];
		let changed: number = 0;
		while (stack.length > 0 && changed < limit) {
			const r: number = stack.pop() as number;
			const c: number = stack.pop() as number;
			if (!this.grid.inside(c, r) || this.grid.get(c, r) !== target) continue;
			this.grid.set(c, r, id);
			changed++;
			stack.push(c + 1, r, c - 1, r, c, r + 1, c, r - 1);
		}
		this.revision++;
		return changed;
	}

	/**
	 * Zones a band beside every road, the quickest way to fill a city the way Cities: Skylines does
	 * with its road-aligned brush. `depth` is measured from the road's outer edge.
	 */
	paintAlongRoads(roads: RoadCorridor[], id: number, depth: number, onlyUnzoned: boolean = true, sides: 'both' | 'left' | 'right' = 'both'): number {
		const index: SpatialHash<RoadPiece> = new SpatialHash<RoadPiece>(32);
		for (const road of roads) {
			if (road.structure !== 'ground') continue;
			const reach: number = Math.max(road.leftExtent, road.rightExtent) + depth;
			for (let i: number = 0; i + 1 < road.points.length; i++) {
				const a = road.points[i];
				const b = road.points[i + 1];
				index.insert({ road, a, b }, Math.min(a.x, b.x) - reach, Math.min(a.z, b.z) - reach, Math.max(a.x, b.x) + reach, Math.max(a.z, b.z) + reach);
			}
		}
		let changed: number = 0;
		for (let r: number = 0; r < this.grid.rows; r++) {
			for (let c: number = 0; c < this.grid.cols; c++) {
				if (onlyUnzoned && this.grid.get(c, r) !== NO_DISTRICT) continue;
				const [cx, cz] = this.cellCentre(c, r);
				if (this.nearRoad(index.query(cx, cz, cx, cz), cx, cz, depth, sides)) {
					this.grid.set(c, r, id);
					changed++;
				}
			}
		}
		this.revision++;
		return changed;
	}

	private nearRoad(pieces: RoadPiece[], x: number, z: number, depth: number, sides: 'both' | 'left' | 'right'): boolean {
		for (const { road, a, b } of pieces) {
			const d: number = pointSegmentDistance(x, z, a.x, a.z, b.x, b.z);
			const dx: number = b.x - a.x;
			const dz: number = b.z - a.z;
			// Positive when the point lies on the right of the direction of travel (X right, Z down screen: cross of forward and offset).
			const side: number = dx * (z - a.z) - dz * (x - a.x);
			const isRight: boolean = side > 0;
			const extent: number = isRight ? road.rightExtent : road.leftExtent;
			if (sides === 'left' && isRight) continue;
			if (sides === 'right' && !isRight) continue;
			if (d >= extent && d <= extent + depth) return true;
		}
		return false;
	}

	clear(): void {
		this.grid.fill(NO_DISTRICT);
		this.revision++;
	}

	/** Cell count per district id. */
	histogram(): Map<number, number> {
		const counts: Map<number, number> = new Map();
		for (let i: number = 0; i < this.grid.data.length; i++) {
			const id: number = this.grid.data[i];
			if (id !== NO_DISTRICT) counts.set(id, (counts.get(id) ?? 0) + 1);
		}
		return counts;
	}

	clone(): DistrictMap {
		return new DistrictMap(this.hf, this.grid.clone());
	}
}
