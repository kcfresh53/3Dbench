import { THREE } from '../../../lib/libs';
import type { ComponentOutput } from './humanoid_types';

/** Isolated viewport: never creates editor elements or touches the project's undo history. */
export function createHumanoidPreview(canvas: HTMLCanvasElement) {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
	renderer.setClearColor(0x252e38);
	renderer.outputEncoding = THREE.sRGBEncoding;
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 10000);
	scene.add(new THREE.HemisphereLight(0xe1efff, 0x53515a, 0.85));
	const sun = new THREE.DirectionalLight(0xffeedb, 1.1);
	sun.position.set(-30, 50, 40); scene.add(sun);
	const fill = new THREE.DirectionalLight(0xc9e4ff, 0.5);
	fill.position.set(40, 15, -30); scene.add(fill);
	const material = new THREE.MeshStandardMaterial({ color: 0xbac6d2, roughness: 0.8, side: THREE.DoubleSide });
	const boneMaterial = new THREE.LineBasicMaterial({ color: 0xffcf80 });
	let model = new THREE.Group(), disposed = false;
	scene.add(model);
	const target = new THREE.Vector3();
	let radius = 60, yaw = Math.PI - 0.45, pitch = 0.12, zoom = 1, drag: [number, number] | undefined;
	function draw() {
		if (disposed) return;
		const width = canvas.clientWidth || 500, height = canvas.clientHeight || 500;
		renderer.setSize(width, height, false);
		camera.aspect = width / height; camera.updateProjectionMatrix();
		camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * radius * zoom, target.y + Math.sin(pitch) * radius * zoom, target.z + Math.cos(yaw) * Math.cos(pitch) * radius * zoom);
		camera.lookAt(target); renderer.render(scene, camera);
	}
	function clear() {
		model.traverse(object => {
			if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) object.geometry.dispose();
		});
		scene.remove(model); model = new THREE.Group(); scene.add(model);
	}
	function update(output: ComponentOutput, flat = false) {
		if (disposed) return;
		clear();
		material.flatShading = flat; material.needsUpdate = true;
		for (const mesh of output.meshes) {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.vertices.flat(), 3));
			const indices: number[] = [];
			for (const face of mesh.faces) for (let i = 1; i < face.length - 1; i++) indices.push(face[0], face[i], face[i + 1]);
			geometry.setIndex(indices); geometry.computeVertexNormals();
			model.add(new THREE.Mesh(geometry, material));
		}
		if (!output.meshes.length) {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.Float32BufferAttribute(output.bones.flatMap(b => [...b.head, ...b.tail]), 3));
			model.add(new THREE.LineSegments(geometry, boneMaterial));
		}
		const bounds = new THREE.Box3().setFromObject(model);
		if (!bounds.isEmpty()) {
			bounds.getCenter(target);
			const size = bounds.getSize(new THREE.Vector3());
			const aspect = (canvas.clientWidth || 500) / (canvas.clientHeight || 500);
			radius = Math.max(size.y, Math.hypot(size.x, size.z) / aspect) / (2 * Math.tan(16 * Math.PI / 180)) * 1.25;
			camera.near = Math.max(radius / 1000, 0.001); camera.far = Math.max(radius * 20, 100);
		}
		canvas.dataset.vertices = String(output.meshes.reduce((sum, m) => sum + m.vertices.length, 0));
		draw();
	}
	const down = (event: PointerEvent) => { drag = [event.clientX, event.clientY]; canvas.setPointerCapture(event.pointerId); };
	const move = (event: PointerEvent) => {
		if (!drag) return;
		yaw -= (event.clientX - drag[0]) * 0.009;
		pitch = Math.max(-1.3, Math.min(1.3, pitch + (event.clientY - drag[1]) * 0.007));
		drag = [event.clientX, event.clientY]; draw();
	};
	const up = () => { drag = undefined; };
	const wheel = (event: WheelEvent) => { event.preventDefault(); zoom = Math.max(0.4, Math.min(3, zoom * Math.exp(event.deltaY * 0.001))); draw(); };
	const reset = () => { yaw = Math.PI - 0.45; pitch = 0.12; zoom = 1; draw(); };
	canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
	canvas.addEventListener('pointerup', up); canvas.addEventListener('lostpointercapture', up);
	canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('dblclick', reset);
	const observer = new ResizeObserver(draw); observer.observe(canvas);
	return {
		update,
		clear() { clear(); draw(); },
		dispose() {
			if (disposed) return;
			disposed = true; observer.disconnect(); clear();
			canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
			canvas.removeEventListener('pointerup', up); canvas.removeEventListener('lostpointercapture', up);
			canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('dblclick', reset);
			material.dispose(); boneMaterial.dispose(); renderer.dispose(); renderer.forceContextLoss();
		},
	};
}
