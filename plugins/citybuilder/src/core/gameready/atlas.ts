import type { Raster } from '../raster';
import { NOMINAL_TILE_M } from '../buildings/tiles';
import type { PixelRect, TileRef } from '../buildings/tiles';
import { tileKind, tilePalette } from '../buildings/tiles';
import { paintSurface } from '../../texture/tile_painters';
import { extrudeMaps, SurfaceMaps } from '../../texture/surface';
import type { FacadeRow, FacadeRun } from '../buildings/types';
import type { MeshPart, PropMesh, Vec2 } from '../types';
import { baysPerStrip, FACADE_MATERIAL, parseFacadeMaterial, TILE_MATERIAL } from '../buildings/mesh';

/** Shelf packer: fills rows from the top, tallest items first. */
export class ShelfPacker {
	private x: number = 0;
	private y: number = 0;
	private rowHeight: number = 0;

	constructor(
		readonly size: number,
		readonly gutter: number,
	) {}

	place(w: number, h: number): PixelRect | null {
		const bw: number = w + 2 * this.gutter;
		const bh: number = h + 2 * this.gutter;
		if (bw > this.size || bh > this.size) return null;
		if (this.x + bw > this.size) {
			this.y += this.rowHeight;
			this.x = 0;
			this.rowHeight = 0;
		}
		if (this.y + bh > this.size) return null;
		const rect: PixelRect = { x: this.x + this.gutter, y: this.y + this.gutter, w, h };
		this.x += bw;
		this.rowHeight = Math.max(this.rowHeight, bh);
		return rect;
	}

	get usedHeight(): number {
		return this.y + this.rowHeight;
	}
}

/** One distinct strip of wall (a storey, or part of one). Strips with identical content share a texture region. */
interface FacadeItem {
	key: string;
	tiles: TileRef[];
	bayWidth: number;
	rowHeight: number;
	variant: number;
	tileW: number;
	rowPx: number;
	w: number;
	h: number;
	rect: PixelRect | null;
}

interface TileItem {
	ref: TileRef;
	rect: PixelRect | null;
}

export interface BuildingInput {
	/** Unique name of the building mesh. */
	name: string;
	runs: FacadeRun[];
	/** Meshes per level of detail, with `facade:` and `tile:` materials. */
	lods: PropMesh[];
}

export interface PackedBuilding {
	name: string;
	/** One part per level of detail, UVs resolved against the packed atlas. */
	lods: MeshPart[];
}

export interface AtlasResult {
	/** Base colour page. */
	raster: Raster;
	/** Occlusion (R), roughness (G) and metallic (B). */
	orm: Raster;
	/** Tangent-space normals, green up. */
	normal: Raster;
	size: number;
	texelsPerMeter: number;
	facadeCount: number;
	tileCount: number;
	buildings: PackedBuilding[];
	/** Fraction of the atlas height that holds content. */
	fill: number;
}

/** Distinct looks a repeated storey cycles through, so a tower's windows do not all share the same blinds. */
const VARIANTS: number = 3;

function stripOf(run: FacadeRun, row: number, chunk: number, ppm: number): FacadeItem {
	const r: FacadeRow = run.rows[row];
	const per: number = baysPerStrip(run);
	const tiles: TileRef[] = r.tiles.slice(chunk * per, (chunk + 1) * per);
	const tileW: number = Math.max(4, Math.round(run.bayWidth * ppm));
	const rowPx: number = Math.max(4, Math.round(r.height * ppm));
	const variant: number = row % VARIANTS;
	return {
		key: `${run.bayWidth}|${r.height.toFixed(3)}|${variant}|${tiles.join('.')}`,
		tiles,
		bayWidth: run.bayWidth,
		rowHeight: r.height,
		variant,
		tileW,
		rowPx,
		w: tileW * tiles.length,
		h: rowPx,
		rect: null,
	};
}

/** Pixels of a shared tile for the current density. */
function tilePx(ppm: number): number {
	return Math.min(256, Math.max(32, Math.round(NOMINAL_TILE_M[0] * ppm)));
}

function tileOf(material: string): TileRef {
	return Number(material.slice(TILE_MATERIAL.length));
}

function tryPack(
	size: number,
	gutter: number,
	ppm: number,
	buildings: BuildingInput[],
	tiles: TileItem[],
	tileSize: number,
): { facades: Map<string, FacadeItem>; used: number } | null {
	const facades: Map<string, FacadeItem> = new Map<string, FacadeItem>();
	for (const b of buildings) {
		for (const run of b.runs) {
			const per: number = baysPerStrip(run);
			run.rows.forEach((_: FacadeRow, row: number): void => {
				for (let chunk: number = 0; chunk * per < run.bays; chunk++) {
					const item: FacadeItem = stripOf(run, row, chunk, ppm);
					if (!facades.has(item.key)) facades.set(item.key, item);
				}
			});
		}
	}
	const packer: ShelfPacker = new ShelfPacker(size, gutter);
	const queue: Array<{ w: number; h: number; assign: (r: PixelRect) => void }> = [];
	for (const f of facades.values()) queue.push({ w: f.w, h: f.h, assign: (r: PixelRect): void => void (f.rect = r) });
	for (const t of tiles) queue.push({ w: tileSize, h: tileSize, assign: (r: PixelRect): void => void (t.rect = r) });
	queue.sort((a, b): number => b.h - a.h || b.w - a.w);
	for (const q of queue) {
		const rect: PixelRect | null = packer.place(q.w, q.h);
		if (rect === null) return null;
		q.assign(rect);
	}
	return { facades, used: packer.usedHeight };
}

/**
 * Bakes every wall of every building into one texture and rewrites the meshes to use it. When the
 * walls do not fit, the resolution is lowered step by step until they do.
 */
export function packBuildings(buildings: BuildingInput[], size: number, gutter: number, texelsPerMeter: number, allowReduction: boolean = true): AtlasResult {
	const tileRefs: Set<TileRef> = new Set<TileRef>();
	for (const b of buildings) {
		for (const mesh of b.lods) {
			for (const face of mesh.faces) if (face.material.startsWith(TILE_MATERIAL)) tileRefs.add(tileOf(face.material));
		}
	}
	const tiles: TileItem[] = [...tileRefs].sort((a: number, b: number): number => a - b).map((ref: TileRef): TileItem => ({ ref, rect: null }));

	let ppm: number = texelsPerMeter;
	let packed: ReturnType<typeof tryPack> = null;
	while (ppm >= 1) {
		packed = tryPack(size, gutter, ppm, buildings, tiles, tilePx(ppm));
		if (packed !== null || !allowReduction) break;
		ppm = Math.floor(ppm * 0.85 * 100) / 100;
	}
	if (packed === null) throw new Error('Building textures do not fit the atlas even at the lowest resolution; raise the atlas size or lower the prefab budget.');

	const maps: SurfaceMaps = new SurfaceMaps(size, size);
	maps.clear([255, 0, 255]);
	const tileSize: number = tilePx(ppm);
	for (const t of tiles) {
		const rect: PixelRect = t.rect as PixelRect;
		maps.paste(paintSurface(tileKind(t.ref), tilePalette(t.ref), tileSize, tileSize, NOMINAL_TILE_M[0], NOMINAL_TILE_M[1], 0), rect.x, rect.y);
		extrudeMaps(maps, rect.x, rect.y, rect.w, rect.h, gutter);
	}
	for (const f of packed.facades.values()) {
		const rect: PixelRect = f.rect as PixelRect;
		f.tiles.forEach((ref: TileRef, bay: number): void => {
			maps.paste(paintSurface(tileKind(ref), tilePalette(ref), f.tileW, f.rowPx, f.bayWidth, f.rowHeight, f.variant * 131 + bay * 17), rect.x + bay * f.tileW, rect.y);
		});
		extrudeMaps(maps, rect.x, rect.y, rect.w, rect.h, gutter);
	}
	const raster: Raster = maps.albedo;

	const tileByRef: Map<TileRef, TileItem> = new Map<TileRef, TileItem>(tiles.map((t: TileItem): [TileRef, TileItem] => [t.ref, t]));
	const inv: number = 1 / size;
	const out: PackedBuilding[] = buildings.map((b: BuildingInput): PackedBuilding => {
		const runById: Map<number, FacadeRun> = new Map<number, FacadeRun>(b.runs.map((run: FacadeRun): [number, FacadeRun] => [run.id, run]));
		const lods: MeshPart[] = b.lods.map((mesh: PropMesh, lod: number): MeshPart => ({
			name: lod === 0 ? b.name : `${b.name}_lod${lod}`,
			atlas: 'city',
			positions: mesh.positions,
			faces: mesh.faces.map((face) => {
				if (face.material.startsWith(FACADE_MATERIAL)) {
					const id = parseFacadeMaterial(face.material);
					const item: FacadeItem = packed.facades.get(stripOf(runById.get(id.run) as FacadeRun, id.row, id.chunk, ppm).key) as FacadeItem;
					const rect: PixelRect = item.rect as PixelRect;
					const uvs: Vec2[] = face.uvs.map((uv: Vec2): Vec2 => [(rect.x + uv[0] * rect.w) * inv, (rect.y + uv[1] * rect.h) * inv]);
					return { indices: face.indices, uvs, normals: face.normals };
				}
				const rect: PixelRect = (tileByRef.get(tileOf(face.material)) as TileItem).rect as PixelRect;
				const uvs: Vec2[] = face.uvs.map((uv: Vec2): Vec2 => [(rect.x + 2 + uv[0] * (rect.w - 4)) * inv, (rect.y + 2 + uv[1] * (rect.h - 4)) * inv]);
				return { indices: face.indices, uvs, normals: face.normals };
			}),
		}));
		return { name: b.name, lods };
	});
	return { raster, orm: maps.orm, normal: maps.normal, size, texelsPerMeter: ppm, facadeCount: packed.facades.size, tileCount: tiles.length, buildings: out, fill: packed.used / size };
}

/** Keep requested texel density by splitting the prefab set into texture pages. */
export function packBuildingPages(buildings:BuildingInput[],size:number,gutter:number,ppm:number,preserve:boolean):AtlasResult[] {
	if(!buildings.length)return [];
	if(!preserve)return [packBuildings(buildings,size,gutter,ppm)];
	try {return [packBuildings(buildings,size,gutter,ppm,false)];}
	catch(error) {
		if(buildings.length===1)throw new Error(`A building exceeds the ${size}px atlas at ${ppm} px/m. Increase atlas size or disable Preserve facade detail.`);
		const mid=Math.ceil(buildings.length/2);
		return [...packBuildingPages(buildings.slice(0,mid),size,gutter,ppm,true),...packBuildingPages(buildings.slice(mid),size,gutter,ppm,true)];
	}
}
