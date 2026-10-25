import type { MeshData, MeshFaceData, TreeLod, Vec2, Vec3 } from '../core/types';

export interface TreePreview {
	update(lods: TreeLod[], atlasUrl: string, pixelated: boolean, status: string): void;
	dispose(): void;
}

function appendMesh(data: MeshData, position: number[], uv: number[]): void {
	for (const face of data.faces as MeshFaceData[]) {
		for (let i = 1; i < face.indices.length - 1; i++) {
			for (const corner of [0, i, i + 1]) {
				const p: Vec3 = data.positions[face.indices[corner]];
				const t: Vec2 = face.uvs[corner];
				position.push(p[0], p[1], p[2]);
				uv.push(t[0], t[1]);
			}
		}
	}
}

/** Isolated orbit viewport with its own renderer (same approach as the building preview). */
export function makePreview(canvas: HTMLCanvasElement, status: HTMLElement): TreePreview {
	const renderer: THREE.WebGLRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.setClearColor(0x252e38);
	renderer.outputEncoding = THREE.sRGBEncoding;

	const scene: THREE.Scene = new THREE.Scene();
	const camera: THREE.PerspectiveCamera = new THREE.PerspectiveCamera(32, 1, 0.1, 5000);
	scene.add(new THREE.HemisphereLight(0xdcecff, 0x49505c, 0.65));
	const sun: THREE.DirectionalLight = new THREE.DirectionalLight(0xffeedb, 0.9);
	sun.position.set(-30, 50, 40);
	scene.add(sun);

	const ground: THREE.Mesh = new THREE.Mesh(
		new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
		new THREE.MeshBasicMaterial({ color: 0x111820 }),
	);
	scene.add(ground);

	let disposed = false;
	let model: THREE.Mesh | null = null;
	let texture: THREE.Texture | null = null;
	const target: THREE.Vector3 = new THREE.Vector3();
	let radius = 80;
	let yaw = 0.6;
	let pitch = 0.2;
	let zoom = 1;
	let token = 0;

	const material: THREE.MeshLambertMaterial = new THREE.MeshLambertMaterial({
		side: THREE.DoubleSide,
		alphaTest: 0.5,
	});

	function draw(): void {
		if (disposed) return;
		const width: number = canvas.clientWidth || 600;
		const height: number = canvas.clientHeight || 600;
		renderer.setSize(width, height, false);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		const r: number = radius * zoom;
		camera.position.set(
			target.x + Math.sin(yaw) * Math.cos(pitch) * r,
			target.y + Math.sin(pitch) * r,
			target.z + Math.cos(yaw) * Math.cos(pitch) * r,
		);
		camera.lookAt(target);
		renderer.render(scene, camera);
	}

	function update(lods: TreeLod[], atlasUrl: string, pixelated: boolean, text: string): void {
		const position: number[] = [];
		const uv: number[] = [];
		for (const lod of lods) {
			appendMesh(lod.trunk, position, uv);
			appendMesh(lod.foliage, position, uv);
		}
		const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
		geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
		geometry.computeVertexNormals();
		geometry.computeBoundingBox();

		if (model) {
			scene.remove(model);
			model.geometry.dispose();
		}
		model = new THREE.Mesh(geometry, material);
		scene.add(model);

		const box: THREE.Box3 = geometry.boundingBox as THREE.Box3;
		const size: THREE.Vector3 = box.getSize(new THREE.Vector3());
		box.getCenter(target);
		const span: number = Math.max(size.y, size.x / camera.aspect, size.z);
		radius = (span / 2 / Math.tan((16 * Math.PI) / 180)) * 1.25 + size.z * 0.5;
		ground.scale.setScalar(Math.max(size.x, size.z) * 0.6 + 4);
		ground.position.set(target.x, box.min.y - 0.01, target.z);
		status.textContent = text;

		const current: number = ++token;
		new THREE.TextureLoader().load(atlasUrl, (loaded: THREE.Texture): void => {
			if (disposed || current !== token) {
				loaded.dispose();
				return;
			}
			loaded.flipY = false;
			loaded.encoding = THREE.sRGBEncoding;
			loaded.magFilter = pixelated ? THREE.NearestFilter : THREE.LinearFilter;
			loaded.minFilter = pixelated ? THREE.NearestMipmapLinearFilter : THREE.LinearMipmapLinearFilter;
			loaded.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
			texture?.dispose();
			texture = loaded;
			material.map = loaded;
			material.needsUpdate = true;
			draw();
		});
		draw();
	}

	let drag: [number, number] | null = null;
	const listeners: Record<string, (e: never) => void> = {
		pointerdown: ((e: PointerEvent): void => {
			drag = [e.clientX, e.clientY];
			canvas.setPointerCapture(e.pointerId);
		}) as (e: never) => void,
		pointermove: ((e: PointerEvent): void => {
			if (!drag) return;
			yaw -= (e.clientX - drag[0]) * 0.009;
			pitch = Math.max(-0.2, Math.min(1.35, pitch + (e.clientY - drag[1]) * 0.007));
			drag = [e.clientX, e.clientY];
			draw();
		}) as (e: never) => void,
		pointerup: ((): void => {
			drag = null;
		}) as (e: never) => void,
		lostpointercapture: ((): void => {
			drag = null;
		}) as (e: never) => void,
		wheel: ((e: WheelEvent): void => {
			e.preventDefault();
			zoom = Math.max(0.4, Math.min(3, zoom * Math.exp(e.deltaY * 0.001)));
			draw();
		}) as (e: never) => void,
		dblclick: ((): void => {
			zoom = 1;
			yaw = 0.6;
			pitch = 0.2;
			draw();
		}) as (e: never) => void,
	};
	for (const [name, fn] of Object.entries(listeners)) canvas.addEventListener(name, fn as EventListener, { passive: false });
	const observer: ResizeObserver = new ResizeObserver(draw);
	observer.observe(canvas);

	return {
		update,
		dispose(): void {
			disposed = true;
			observer.disconnect();
			for (const [name, fn] of Object.entries(listeners)) canvas.removeEventListener(name, fn as EventListener);
			model?.geometry.dispose();
			texture?.dispose();
			material.dispose();
			ground.geometry.dispose();
			(ground.material as THREE.Material).dispose();
			renderer.dispose();
		},
	};
}
