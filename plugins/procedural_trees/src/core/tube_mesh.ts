import type { Branch, Vec2, Vec3 } from './types';
import { MeshBuilder } from './mesh_builder';
import { add, lerp, scale, transportFrames } from './math';
import type { Frame } from './math';
import type { UvRect } from './uv_layout';

interface VWindow {
	bottom: number;
	top: number;
}

/** Deterministic 0..1 value from a branch so every branch samples a different bark stretch. */
function branchHash(branch: Branch): number {
	const x: number = Math.sin(branch.length * 12.9898 + branch.level * 78.233 + branch.points[0][1] * 4.1414) * 43758.5453;
	return x - Math.floor(x);
}

/**
 * Chooses the V window a branch samples. The window length follows the branch's
 * length-to-circumference ratio, so thick trunks get undistorted texels while
 * thin twigs just stretch the vertical streaks. Each branch starts at a different offset.
 */
function barkWindow(branch: Branch, uv: UvRect): VWindow {
	const live: number[] = branch.radii.filter((r: number): boolean => r > 1e-6);
	const meanRadius: number = live.reduce((a: number, b: number): number => a + b, 0) / Math.max(1, live.length);
	const circumference: number = Math.PI * 2 * Math.max(meanRadius, 1e-6);
	const width: number = uv.u1 - uv.u0;
	const height: number = uv.v1 - uv.v0;
	const span: number = Math.min(height, (branch.length * width) / circumference);
	const slack: number = height - span;
	const bottom: number = uv.v1 - branchHash(branch) * slack;
	return { bottom, top: bottom - span };
}

/**
 * Adds a tapered tube along a branch. Rings share vertices between segments,
 * the tip collapses to a single vertex, and there are no end caps: the base
 * starts buried inside the parent so nothing hidden is ever generated.
 */
export function addBranchTube(mb: MeshBuilder, branch: Branch, sides: number, uv: UvRect): void {
	const window: VWindow = barkWindow(branch, uv);
	const frames: Frame[] = transportFrames(branch.points);
	const last: number = branch.points.length - 1;
	const rings: number[][] = [];

	for (let i = 0; i <= last; i++) {
		const radius: number = branch.radii[i];
		const center: Vec3 = branch.points[i];
		if (radius <= 1e-6) {
			rings.push([mb.addVertex(center)]);
			continue;
		}
		const frame: Frame = frames[i];
		const ring: number[] = [];
		for (let k = 0; k < sides; k++) {
			const angle: number = (Math.PI * 2 * k) / sides;
			const offset: Vec3 = add(
				scale(frame.u, radius * Math.cos(angle)),
				scale(frame.v, radius * Math.sin(angle)),
			);
			ring.push(mb.addVertex(add(center, offset)));
		}
		rings.push(ring);
	}

	for (let i = 0; i < last; i++) {
		const lower: number[] = rings[i];
		const upper: number[] = rings[i + 1];
		if (lower.length === 1) continue;
		const vLow: number = lerp(window.bottom, window.top, i / last);
		const vHigh: number = lerp(window.bottom, window.top, (i + 1) / last);
		for (let k = 0; k < sides; k++) {
			const next: number = (k + 1) % sides;
			const uA: number = lerp(uv.u0, uv.u1, k / sides);
			const uB: number = lerp(uv.u0, uv.u1, (k + 1) / sides);
			if (upper.length === 1) {
				const tipUv: Vec2 = [(uA + uB) / 2, vHigh];
				mb.addFace([lower[k], lower[next], upper[0]], [[uA, vLow], [uB, vLow], tipUv]);
			} else {
				mb.addFace(
					[lower[k], lower[next], upper[next], upper[k]],
					[[uA, vLow], [uB, vLow], [uB, vHigh], [uA, vHigh]],
				);
			}
		}
	}
}
