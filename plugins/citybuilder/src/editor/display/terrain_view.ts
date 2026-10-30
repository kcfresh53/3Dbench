import { TerrainMaterials } from './terrain_materials';
import { CITY_RENDER_ORDER } from './render_order';
import { districtById, hexToRgb } from '../../core/district/library';
import type { DistrictMap } from '../../core/district/map';
import { Raster } from '../../core/raster';
import type { Heightfield } from '../../core/terrain/heightfield';
import { buildPatch, patchRanges } from '../../core/terrain/mesh';
import type { PatchRange, TerrainPatch } from '../../core/terrain/mesh';
import { createTerrainPainter, paintSignature, paintTerrain } from '../../core/terrain/paint';
import type { PaintInput, TerrainPainter } from '../../core/terrain/paint';
import type { GridRect } from '../../core/types';
import { disposeTree, rasterTexture, mappedTexture, redraw } from './gl';
import type { View, ViewContext } from './view';

const PATCH_CELLS: number = 32;
const DISPLAY_TEXTURE: number = 2048;
/** Shown at once while the full texture bakes in the background. */
const PREVIEW_TEXTURE: number = 512;
/** Milliseconds of baking per slice, leaving the rest of each frame to the editor. */
const BAKE_SLICE_MS: number = 8;
const PAD_COLOR: [number, number, number] = [136, 146, 118];

interface PatchMesh {
	range: PatchRange;
	ground: THREE.Mesh;
	depth: THREE.Mesh;
	overlay: THREE.Mesh;
}

function geometryOf(patch: TerrainPatch): THREE.BufferGeometry {
	const g: THREE.BufferGeometry = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(patch.positions, 3));
	g.setAttribute('normal', new THREE.BufferAttribute(patch.normals, 3));
	g.setAttribute('uv', new THREE.BufferAttribute(patch.uvs, 2));
	g.setAttribute('uv2', g.getAttribute('uv'));
	g.setIndex(new THREE.BufferAttribute(patch.indices, 1));
	g.computeBoundingSphere();
	return g;
}

/** The ground, split into patches so a brush stroke only rebuilds the patches it touches. */
export class TerrainView implements View {
	readonly root: THREE.Object3D = new THREE.Object3D();
	private patches: PatchMesh[] = [];
	private overlayMaterial: THREE.MeshBasicMaterial | null = null;
	private overlayTexture: THREE.DataTexture | null = null;
	private overlayRaster: Raster | null = null;
	private source: Heightfield | null = null;
	private albedo: THREE.DataTexture | null = null;
	private readonly layerMaterials = new TerrainMaterials();
	private albedoShape: string = '';
	private albedoSignature: string = '';
	/** Told whenever the terrain texture changes, so the water can show it through its surface. */
	onAlbedo: ((texture: THREE.Texture | null) => void) | null = null;
	private bakeToken: number = 0;
	private bakeTimer: ReturnType<typeof setTimeout> | null = null;

	rebuild(ctx: ViewContext): void {
		this.cancelBake();
		this.clear();
		const hf: Heightfield = ctx.plan.terrain.heights;
		this.source = hf;
		const s = ctx.state.settings;
		const input: PaintInput = {
			hf,
			surfaces: ctx.plan.surfaces,
			roadWeight: ctx.plan.terrain.roadbedWeight,
			lotWeight: ctx.plan.terrain.lotWeight,
			padColor: PAD_COLOR,
			waterLevel: s.waterLevel,
			sun: s.sun,
			waterTint: 0,
			size: DISPLAY_TEXTURE,
			seed: s.seed,
		};
		const signature: string = paintSignature(input);
		const shape: string = `${hf.cols}x${hf.rows}x${hf.cellSize}`;
		if (this.albedo === null || this.albedoShape !== shape || signature !== this.albedoSignature) {
			// First view of this terrain: a small bake appears at once, the sharp one follows.
			this.setAlbedo(mappedTexture(paintTerrain({ ...input, size: PREVIEW_TEXTURE }), { srgb: true, anisotropy: 16 }), shape, '');
		}
		const materials = this.layerMaterials.build(ctx);
		// PBR surfaces blend in the transparent pass. Write the solid terrain's depth first so
		// water and other transparent objects are still occluded by dry land, including shore edges.
		const depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true });
		this.overlayRaster = new Raster(hf.cellCols, hf.cellRows);
		this.overlayTexture = rasterTexture(this.overlayRaster, true);
		this.overlayMaterial = new THREE.MeshBasicMaterial({ map: this.overlayTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
		for (const range of patchRanges(hf, PATCH_CELLS)) {
			const geometry: THREE.BufferGeometry = geometryOf(buildPatch(hf, range.c0, range.r0, range.c1, range.r1));
			const ground: THREE.Mesh = new THREE.Mesh(geometry, materials[0]);
			ground.receiveShadow = true;
			ground.renderOrder = CITY_RENDER_ORDER.terrain;
			const overlay: THREE.Mesh = new THREE.Mesh(geometry, this.overlayMaterial);
			overlay.visible = false;
			overlay.renderOrder = CITY_RENDER_ORDER.districts;
			const depth = new THREE.Mesh(geometry, depthMaterial);
			depth.name = 'City terrain depth';
			this.root.add(ground, depth, overlay);
			materials.slice(1).forEach((material,i)=>{
				const layer=new THREE.Mesh(geometry,material);layer.receiveShadow=true;layer.renderOrder=CITY_RENDER_ORDER.terrain+i+1;
				this.root.add(layer);
			});
			this.patches.push({ range, ground, depth, overlay });
		}
		this.setDistricts(ctx.state.districts);
		if (signature !== this.albedoSignature) this.bake(input, shape, signature);
	}

	/** Bakes the full texture a slice at a time and swaps it in when done; a newer rebuild cancels it. */
	private bake(input: PaintInput, shape: string, signature: string): void {
		const token: number = ++this.bakeToken;
		const painter: TerrainPainter = createTerrainPainter(input);
		let row: number = 0;
		const step = (): void => {
			this.bakeTimer = null;
			if (token !== this.bakeToken) return;
			const started: number = performance.now();
			do {
				painter.paintRows(row, row + 8);
				row += 8;
			} while (row < input.size && performance.now() - started < BAKE_SLICE_MS);
			if (row < input.size) {
				this.bakeTimer = setTimeout(step, 0);
				return;
			}
			this.setAlbedo(mappedTexture(painter.raster, { srgb: true, anisotropy: 16 }), shape, signature);

			redraw();
		};
		this.bakeTimer = setTimeout(step, 0);
	}

	private setAlbedo(texture: THREE.DataTexture, shape: string, signature: string): void {
		this.albedo?.dispose();
		this.albedo = texture;
		this.albedoShape = shape;
		this.albedoSignature = signature;
		this.onAlbedo?.(texture);
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

	/** Width of the albedo texture currently shown, pixels. */
	get textureSize(): number {
		return this.albedo?.image.width ?? 0;
	}

	showOverlay(visible: boolean): void {
		for (const p of this.patches) p.overlay.visible = visible;
	}

	private clear(): void {
		this.overlayTexture?.dispose();
		disposeTree(this.root);
		this.patches = [];
		this.overlayMaterial = null;
		this.overlayTexture = null;
		this.overlayRaster = null;
	}

	private cancelBake(): void {
		this.bakeToken++;
		if (this.bakeTimer !== null) clearTimeout(this.bakeTimer);
		this.bakeTimer = null;
	}

	dispose(): void {
		this.cancelBake();
		this.clear();
		this.albedo?.dispose();
		this.albedo = null;
		this.layerMaterials.dispose();
		this.albedoSignature = '';
	}
}
