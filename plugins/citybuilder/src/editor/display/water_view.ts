import type { Heightfield } from '../../core/terrain/heightfield';
import { buildWaterDepthMap } from '../../core/water/depth_map';
import type { WaterDepthMap } from '../../core/water/depth_map';
import type { WaterSettings } from '../../core/water/settings';
import { buildWaterTextures } from '../../core/water/textures';
import type { WaterTextureSet } from '../../core/water/textures';
import { disposeTree } from './gl';
import { applyWaterSettings, createWaterUniforms, WATER_FRAGMENT, WATER_VERTEX } from './water_shader';
import type { WaterTextures, WaterUniforms } from './water_shader';
import type { View, ViewContext } from './view';

/** Frames per second of the animated preview. */
const ANIMATION_FPS: number = 30;

function repeatingTexture(bytes: Uint8Array, size: number): THREE.DataTexture {
	const texture: THREE.DataTexture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.generateMipmaps = true;
	texture.flipY = false;
	texture.needsUpdate = true;
	return texture;
}

/** Cheap fingerprint of the ground heights and water line, so unchanged terrain keeps its depth map. */
function depthSignature(hf: Heightfield, level: number): string {
	let hash: number = 2166136261;
	const words: Uint32Array = new Uint32Array(hf.heights.buffer, hf.heights.byteOffset, hf.heights.length);
	for (let i: number = 0; i < words.length; i++) hash = Math.imul(hash ^ words[i], 16777619) >>> 0;
	return `${hash}:${hf.cols}x${hf.rows}x${hf.cellSize}:${level}`;
}

/**
 * Preview water: a sheet at the water level that runs the ported Godot shader. It lives under the display
 * root, which is flagged `no_export`, and is flagged itself too, so it never reaches an exported or baked
 * file. The game draws its own water.
 */
export class WaterView implements View {
	readonly root: THREE.Object3D = new THREE.Object3D();
	private textures: WaterTextures | null = null;
	private textureData: WaterTextureSet | null = null;
	private uniforms: WaterUniforms | null = null;
	private material: THREE.ShaderMaterial | null = null;
	private mesh: THREE.Mesh | null = null;
	private depthTexture: THREE.DataTexture | null = null;
	private signature: string = '';
	private frame: number = 0;
	private lastFrame: number = 0;
	private running: boolean = false;
	private animate: boolean = false;

	constructor() {
		(this.root as unknown as { no_export: boolean }).no_export = true;
	}

	private ensureMaterial(): void {
		if (this.material) return;
		this.textureData = buildWaterTextures();
		const size: number = this.textureData.size;
		this.textures = {
			normal1: repeatingTexture(this.textureData.normal1, size),
			normal2: repeatingTexture(this.textureData.normal2, size),
			highlights1: repeatingTexture(this.textureData.highlights1, size),
			highlights2: repeatingTexture(this.textureData.highlights2, size),
			foam: repeatingTexture(this.textureData.foam, size),
		};
		this.uniforms = createWaterUniforms(this.textures);
		this.material = new THREE.ShaderMaterial({
			uniforms: this.uniforms as never,
			vertexShader: WATER_VERTEX,
			fragmentShader: WATER_FRAGMENT,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
	}

	rebuild(ctx: ViewContext): void {
		this.ensureMaterial();
		const hf: Heightfield = ctx.plan.terrain.heights;
		const settings = ctx.state.settings;
		const level: number = settings.waterLevel;
		const uniforms: WaterUniforms = this.uniforms as WaterUniforms;
		const signature: string = depthSignature(hf, level);
		if (signature !== this.signature || !this.mesh) {
			this.signature = signature;
			const map: WaterDepthMap = buildWaterDepthMap(hf, level, 512);
			this.depthTexture?.dispose();
			const texture: THREE.DataTexture = new THREE.DataTexture(map.depths, map.size, map.size, THREE.RedFormat, THREE.FloatType);
			texture.magFilter = THREE.LinearFilter;
			texture.minFilter = THREE.LinearFilter;
			texture.wrapS = THREE.ClampToEdgeWrapping;
			texture.wrapT = THREE.ClampToEdgeWrapping;
			texture.generateMipmaps = false;
			texture.flipY = false;
			texture.needsUpdate = true;
			this.depthTexture = texture;
			uniforms.uDepth.value = texture;
			if (this.mesh) {
				this.root.remove(this.mesh);
				this.mesh.geometry.dispose();
			}
			// Twice the map, so a shoreline never shows the sheet's edge. The geometry is already flat on XZ.
			const size: number = Math.max(hf.width, hf.depth) * 2;
			const geometry: THREE.PlaneGeometry = new THREE.PlaneGeometry(size, size);
			geometry.rotateX(-Math.PI / 2);
			this.mesh = new THREE.Mesh(geometry, this.material as THREE.ShaderMaterial);
			(this.mesh as unknown as { no_export: boolean }).no_export = true;
			this.mesh.frustumCulled = false;
			this.mesh.renderOrder = 1;
			this.root.add(this.mesh);
		}
		(this.mesh as THREE.Mesh).position.y = level;
		(uniforms.uMapOrigin.value as THREE.Vector2).set(hf.originX, hf.originZ);
		(uniforms.uMapSize.value as THREE.Vector2).set(hf.width, hf.depth);
		(uniforms.uSunDir.value as THREE.Vector3).set(settings.sun[0], settings.sun[1], settings.sun[2]).normalize();
		this.configure(settings.water);
	}

	/** Terrain albedo seen through the water. Called again whenever the terrain bake finishes. */
	setBackdrop(texture: THREE.Texture | null): void {
		if (!this.uniforms) return;
		this.uniforms.uBackdrop.value = texture;
		this.uniforms.uHasBackdrop.value = texture ? 1 : 0;
	}

	/** Applies new water settings without rebuilding anything. */
	configure(settings: WaterSettings): void {
		if (this.uniforms) applyWaterSettings(this.uniforms, settings);
		this.root.visible = settings.show;
		this.animate = settings.animate;
		this.updateClock();
	}

	/** Starts or stops the animation clock to match visibility and settings. */
	updateClock(): void {
		const wanted: boolean = this.animate && this.root.visible && this.mesh !== null;
		if (wanted && !this.running) {
			this.running = true;
			this.frame = requestAnimationFrame((time: number): void => this.tick(time));
		} else if (!wanted && this.running) {
			this.running = false;
			cancelAnimationFrame(this.frame);
		}
	}

	private tick(now: number): void {
		if (!this.running) return;
		this.frame = requestAnimationFrame((time: number): void => this.tick(time));
		if (now - this.lastFrame < 1000 / ANIMATION_FPS || document.hidden || !this.isShown()) return;
		this.lastFrame = now;
		if (this.uniforms) this.uniforms.uTime.value = now / 1000;
		// Only redraw the viewports that are on screen; a full Canvas.updateAll would rebuild every element.
		for (const preview of Preview.all) if (preview.canvas?.isConnected && preview.canvas.offsetParent !== null) preview.render();
	}

	/** True while the city is attached to the open project. */
	private isShown(): boolean {
		// Shown when every ancestor up to the project's model is visible. The model itself sits inside the scene,
		// so the walk must stop there rather than at the top of the scene.
		const model: THREE.Object3D | undefined = typeof Project === 'undefined' ? undefined : (Project?.model_3d as THREE.Object3D | undefined);
		let node: THREE.Object3D | null = this.root;
		while (node) {
			if (!node.visible) return false;
			if (model && node === model) return true;
			node = node.parent;
		}
		return !model;
	}

	dispose(): void {
		this.running = false;
		cancelAnimationFrame(this.frame);
		disposeTree(this.root);
		this.material?.dispose();
		this.depthTexture?.dispose();
		for (const texture of Object.values(this.textures ?? {})) (texture as THREE.Texture).dispose();
		this.material = null;
		this.mesh = null;
		this.uniforms = null;
		this.textures = null;
		this.depthTexture = null;
		this.signature = '';
	}
}
