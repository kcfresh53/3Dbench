import { districtById, hexToRgb } from '../../core/district/library';
import type { DistrictMap } from '../../core/district/map';
import { Raster } from '../../core/raster';
import type { Heightfield } from '../../core/terrain/heightfield';
import { buildPatch, patchRanges } from '../../core/terrain/mesh';
import type { PatchRange, TerrainPatch } from '../../core/terrain/mesh';
import { paintTerrain } from '../../core/terrain/paint';
import type { GridRect } from '../../core/types';
import { disposeTree, rasterTexture } from './gl';
import type { View, ViewContext } from './view';

const PATCH_CELLS: number = 32;
const DISPLAY_TEXTURE: number = 2048;
const PAD_COLOR: [number, number, number] = [150, 148, 140];

interface PatchMesh {
	range: PatchRange;
	ground: THREE.Mesh;
	overlay: THREE.Mesh;
}

function geometryOf(patch: TerrainPatch): THREE.BufferGeometry {
	const g: THREE.BufferGeometry = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(patch.positions, 3));
	g.setAttribute('normal', new THREE.BufferAttribute(patch.normals, 3));
	g.setAttribute('uv', new THREE.BufferAttribute(patch.uvs, 2));
	g.setIndex(new THREE.BufferAttribute(patch.indices, 1));
	g.computeBoundingSphere();
	return g;
}

/** The ground, split into patches so a brush stroke only rebuilds the patches it touches. */
export class TerrainView implements View {
	readonly root: THREE.Object3D = new THREE.Object3D();
	private patches: PatchMesh[] = [];
	private groundMaterial: THREE.MeshBasicMaterial | null = null;
	private overlayMaterial: THREE.MeshBasicMaterial | null = null;
	private overlayTexture: THREE.DataTexture | null = null;
	private overlayRaster: Raster | null = null;
	private source: Heightfield | null = null;

	rebuild(ctx: ViewContext): void {
		this.clear();
		const hf: Heightfield = ctx.plan.terrain.heights;
		this.source = hf;
		const s = ctx.state.settings;
		const albedo: Raster = paintTerrain({
			hf,
			surfaces: ctx.plan.surfaces,
			roadWeight: ctx.plan.terrain.roadWeight,
			lotWeight: ctx.plan.terrain.lotWeight,
			padColor: PAD_COLOR,
			waterLevel: s.waterLevel,
			sun: s.sun,
			size: DISPLAY_TEXTURE,
			seed: s.seed,
		});
		this.groundMaterial = new THREE.MeshBasicMaterial({ map: rasterTexture(albedo, false) });
		this.overlayRaster = new Raster(hf.cellCols, hf.cellRows);
		this.overlayTexture = rasterTexture(this.overlayRaster, true);
		this.overlayMaterial = new THREE.MeshBasicMaterial({ map: this.overlayTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
		for (const range of patchRanges(hf, PATCH_CELLS)) {
			const geometry: THREE.BufferGeometry = geometryOf(buildPatch(hf, range.c0, range.r0, range.c1, range.r1));
			const ground: THREE.Mesh = new THREE.Mesh(geometry, this.groundMaterial);
			const overlay: THREE.Mesh = new THREE.Mesh(geometry, this.overlayMaterial);
			overlay.visible = false;
			overlay.renderOrder = 2;
			this.root.add(ground, overlay);
			this.patches.push({ range, ground, overlay });
		}
		this.setDistricts(ctx.state.districts);
	}

	/** Re-reads heights from `hf` for the patches that cover `rect`; used while a brush is dragging. */
	liveEdit(hf: Heightfield, rect: GridRect): void {
		if (this.source === null) return;
		for (const p of this.patches) {
			const r: PatchRange = p.range;
			if (rect.c1 < r.c0 || rect.c0 > r.c1 || rect.r1 < r.r0 || rect.r0 > r.r1) continue;
			const fresh: TerrainPatch = buildPatch(hf, r.c0, r.r0, r.c1, r.r1);
			const pos = p.ground.geometry.getAttribute('position') as THREE.BufferAttribute;
			const nor = p.ground.geometry.getAttribute('normal') as THREE.BufferAttribute;
			(pos.array as Float32Array).set(fresh.positions);
			(nor.array as Float32Array).set(fresh.normals);
			pos.needsUpdate = true;
			nor.needsUpdate = true;
			p.ground.geometry.computeBoundingSphere();
		}
	}

	/** Colours the overlay texture from the district map. */
	setDistricts(map: DistrictMap): void {
		const raster: Raster | null = this.overlayRaster;
		if (!raster || !this.overlayTexture) return;
		for (let r: number = 0; r < map.grid.rows; r++) {
			for (let c: number = 0; c < map.grid.cols; c++) {
				const id: number = map.grid.get(c, r);
				const color = id === 0 ? null : districtById(id)?.color;
				if (color) raster.set(c, r, hexToRgb(color), 140);
				else raster.set(c, r, [0, 0, 0], 0);
			}
		}
		this.overlayTexture.needsUpdate = true;
	}

	showOverlay(visible: boolean): void {
		for (const p of this.patches) p.overlay.visible = visible;
	}

	private clear(): void {
		this.groundMaterial?.map?.dispose();
		this.overlayTexture?.dispose();
		disposeTree(this.root);
		this.patches = [];
		this.groundMaterial = null;
		this.overlayMaterial = null;
		this.overlayTexture = null;
		this.overlayRaster = null;
	}

	dispose(): void {
		this.clear();
	}
}
