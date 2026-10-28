import type { Raster } from '../../core/raster';
import type { PropMesh, Vec2 } from '../../core/types';

/** Texture from a CPU raster. Row 0 of the raster is v = 0 (no flip), matching the UVs the core writes. */
export function rasterTexture(raster: Raster, nearest: boolean): THREE.DataTexture {
	const bytes: Uint8Array = new Uint8Array(raster.data.buffer, raster.data.byteOffset, raster.data.length);
	const texture: THREE.DataTexture = new THREE.DataTexture(bytes, raster.width, raster.height, THREE.RGBAFormat);
	texture.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
	texture.minFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
	texture.generateMipmaps = false;
	texture.flipY = false;
	texture.needsUpdate = true;
	return texture;
}

/** Triangulates polygon faces (fans) and resolves their material UVs through `resolve`. */
export function propGeometry(mesh: PropMesh, resolve: (material: string, uv: Vec2) => Vec2): THREE.BufferGeometry {
	const positions: number[] = [];
	const uvs: number[] = [];
	for (const face of mesh.faces) {
		for (let i: number = 1; i < face.indices.length - 1; i++) {
			for (const j of [0, i, i + 1]) {
				const p: [number, number, number] = mesh.positions[face.indices[j]];
				positions.push(p[0], p[1], p[2]);
				const uv: Vec2 = resolve(face.material, face.uvs[j]);
				uvs.push(uv[0], uv[1]);
			}
		}
	}
	const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	geometry.computeBoundingSphere();
	return geometry;
}

/** Releases the GPU resources of everything under an object, then detaches its children. */
export function disposeTree(object: THREE.Object3D): void {
	object.traverse((node: THREE.Object3D): void => {
		const mesh = node as THREE.Mesh;
		mesh.geometry?.dispose();
		const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
		if (Array.isArray(material)) material.forEach((m: THREE.Material): void => m.dispose());
		else material?.dispose();
	});
	object.clear();
}

export function hexColor(rgb: [number, number, number]): number {
	return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
}
