import type { PropFace, PropMesh, Vec2, Vec3 } from './types';

/** Props built directly at their final, optimised resolution. Metres, +X faces the road, +Y up. */
function bollard(): PropMesh {
	const sides: number = 6;
	const radius: number = 0.09;
	const height: number = 0.9;
	const positions: Vec3[] = [];
	for (let i: number = 0; i < sides; i++) {
		const a: number = (i / sides) * Math.PI * 2;
		positions.push([Math.cos(a) * radius, 0, Math.sin(a) * radius]);
	}
	for (let i: number = 0; i < sides; i++) {
		const a: number = (i / sides) * Math.PI * 2;
		positions.push([Math.cos(a) * radius, height, Math.sin(a) * radius]);
	}
	positions.push([0, height, 0]);
	const faces: PropFace[] = [];
	const material: string = 'Tunnel Barrier';
	const uv = (u: number, v: number): Vec2 => [u, v];
	for (let i: number = 0; i < sides; i++) {
		const j: number = (i + 1) % sides;
		// Counter-clockwise seen from outside: bottom i, bottom j, top j, top i.
		faces.push({ indices: [i, j, j + sides, i + sides], uvs: [uv(i / sides, 1), uv((i + 1) / sides, 1), uv((i + 1) / sides, 0), uv(i / sides, 0)], material });
		faces.push({ indices: [i + sides, j + sides, sides * 2], uvs: [uv(0.2, 0.2), uv(0.4, 0.2), uv(0.3, 0.4)], material });
	}
	return { positions, faces };
}

const BUILDERS: Record<string, () => PropMesh> = { Bollard: bollard };

export function proceduralProp(name: string): PropMesh | undefined {
	const build: (() => PropMesh) | undefined = BUILDERS[name];
	return build ? build() : undefined;
}
