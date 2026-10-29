type RGB = [number, number, number];

interface SkyboxPalette {
	zenith: RGB
	horizon: RGB
	ground: RGB
	sun?: {direction: RGB, color: RGB, size: number, glow: number}
	clouds?: number
}

// Direction-based sampling keeps all six faces continuous, including at the poles.
const palettes: Record<string, SkyboxPalette> = {
	neutral: {zenith: [92, 96, 103], horizon: [178, 181, 186], ground: [65, 68, 74]},
	clear_sky: {
		zenith: [35, 103, 190], horizon: [194, 219, 239], ground: [91, 102, 111], clouds: 0.3,
		sun: {direction: [-0.6, 0.65, -0.45], color: [255, 249, 224], size: 0.009, glow: 0.14},
	},
	overcast: {zenith: [143, 155, 170], horizon: [218, 222, 226], ground: [105, 111, 116], clouds: 0.65},
	sunset: {
		zenith: [47, 49, 99], horizon: [248, 158, 103], ground: [62, 53, 66], clouds: 0.2,
		sun: {direction: [-0.8, 0.08, -0.6], color: [255, 230, 176], size: 0.018, glow: 0.28},
	},
	night: {
		zenith: [8, 14, 34], horizon: [51, 65, 93], ground: [16, 21, 33],
		sun: {direction: [0.5, 0.6, -0.62], color: [213, 224, 247], size: 0.018, glow: 0.035},
	},
};

export type PreviewSkybox = 'neutral' | 'clear_sky' | 'overcast' | 'sunset' | 'night';

/** Generate a small, offline cubemap on first use; each scene retains its texture. */
export function createPreviewSkybox(preset: PreviewSkybox): THREE.CubeTexture {
	const palette = palettes[preset];
	const size = 256;
	const sun = palette.sun;
	const sunLength = sun ? Math.hypot(...sun.direction) : 1;
	const faces = Array.from({length: 6}, (_, face) => {
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = size;
		const context = canvas.getContext('2d');
		const pixels = context.createImageData(size, size);
		for (let row = 0; row < size; row++) {
			for (let column = 0; column < size; column++) {
				const u = 2 * (column + 0.5) / size - 1;
				const v = 2 * (row + 0.5) / size - 1;
				// CubeTexture order: +X, -X, +Y, -Y, +Z, -Z.
				let [x, y, z] = [
					[1, -v, -u], [-1, -v, u], [u, 1, v],
					[u, -1, -v], [u, -v, 1], [-u, -v, -1],
				][face];
				const length = Math.hypot(x, y, z);
				x /= length; y /= length; z /= length;
				const end = y >= 0 ? palette.zenith : palette.ground;
				const blend = Math.pow(Math.abs(y), y >= 0 ? 0.55 : 0.3);
				const cloudPattern = Math.sin(x * 15 + Math.sin(z * 11))
					+ Math.sin(z * 19 - y * 12) * 0.5 + Math.sin(x * 37 + z * 23) * 0.2;
				const clouds = palette.clouds && y > 0
					? Math.max(0, cloudPattern - 0.15) * palette.clouds * Math.min(1, y * 5) : 0;
				const distance = sun ? Math.max(0, 1 - (x * sun.direction[0] + y * sun.direction[1] + z * sun.direction[2]) / sunLength) : 1;
				const sunlight = sun ? Math.min(1, Math.exp(-distance / (sun.size * sun.size))
					+ Math.exp(-distance / 0.08) * sun.glow) : 0;
				const offset = (row * size + column) * 4;
				for (let channel = 0; channel < 3; channel++) {
					let color = palette.horizon[channel] * (1 - blend) + end[channel] * blend;
					color += (235 - color) * Math.min(0.7, clouds);
					if (sun) color += (sun.color[channel] - color) * sunlight;
					pixels.data[offset + channel] = color;
				}
				pixels.data[offset + 3] = 255;
			}
		}
		context.putImageData(pixels, 0, 0);
		return canvas;
	});
	const texture = new THREE.CubeTexture(faces);
	texture.encoding = THREE.sRGBEncoding;
	texture.mapping = THREE.CubeReflectionMapping;
	texture.needsUpdate = true;
	return texture;
}
