import type { View, ViewContext } from './view';
import { disposeTree, refreshShadows } from './gl';

/** Daylight and a distant sky, scoped to the live city and removed with it. */
export class LightingView implements View {
	readonly root = new THREE.Object3D();
	private skyChosen: boolean = false;
	private sun: THREE.DirectionalLight | null = null;
	private renderers = new Map<THREE.WebGLRenderer, { enabled: boolean; type: THREE.ShadowMapType; auto: boolean }>();

	rebuild(ctx: ViewContext): void {
		this.clear();
		const span = Math.max(ctx.state.terrain.width, ctx.state.terrain.depth);
		const direction = new THREE.Vector3(...ctx.state.settings.sun).normalize();
		this.sun = new THREE.DirectionalLight(0xfff3dc, 1.6);
		this.sun.position.copy(direction.multiplyScalar(span));
		this.sun.castShadow = true;
		this.sun.shadow.mapSize.set(2048, 2048);
		const camera = this.sun.shadow.camera;
		camera.left = camera.bottom = -Math.min(span * .72, 1100);
		camera.right = camera.top = Math.min(span * .72, 1100);
		camera.near = 1; camera.far = span * 3;
		camera.updateProjectionMatrix();
		this.sun.shadow.bias = -.00015;
		this.sun.shadow.normalBias = .25;
		this.root.add(this.sun, this.sun.target, new THREE.HemisphereLight(0xc4ddf3, 0x72735b, .4));
		// The sky is a preview scene of the app, not part of this plugin. Start in a clear day when none is chosen.
		if (!this.skyChosen) {
			this.skyChosen = true;
			if (typeof PreviewScene !== 'undefined' && !PreviewScene.active) void PreviewScene.scenes.clear_sky?.select();
		}
		// Each editor viewport has its own renderer. Restore their original settings on disposal.
		if (typeof Preview !== 'undefined') for (const preview of Preview.all) {
			const renderer = (preview as unknown as { renderer: THREE.WebGLRenderer }).renderer;
			if (!renderer) continue;
			if (!this.renderers.has(renderer)) this.renderers.set(renderer, { enabled: renderer.shadowMap.enabled, type: renderer.shadowMap.type, auto: renderer.shadowMap.autoUpdate });
			renderer.shadowMap.enabled = true;
			renderer.shadowMap.type = THREE.PCFSoftShadowMap;
			// A city does not move: render the shadow when the city changes instead of every frame.
			renderer.shadowMap.autoUpdate = false;
			renderer.shadowMap.needsUpdate = true;
		}
	}

	setEnabled(enabled: boolean): void {
		this.root.visible = enabled;
		for (const [renderer, previous] of this.renderers) {
			renderer.shadowMap.enabled = enabled ? true : previous.enabled;
			renderer.shadowMap.type = enabled ? THREE.PCFSoftShadowMap : previous.type;
			renderer.shadowMap.autoUpdate = enabled ? false : previous.auto;
		}
		if (enabled) refreshShadows();
	}

	private clear(): void {
		this.sun?.shadow.map?.dispose();
		this.sun = null;
		disposeTree(this.root);
	}

	dispose(): void {
		this.clear();
		this.skyChosen = false;
		for (const [renderer, previous] of this.renderers) {
			renderer.shadowMap.enabled = previous.enabled;
			renderer.shadowMap.type = previous.type;
			renderer.shadowMap.autoUpdate = previous.auto;
		}
		this.renderers.clear();
	}
}
