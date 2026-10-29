import type { Vec2, Vec3 } from '../types';
import type { BuildingModel, BuildingSpec, FacadeRun, ModelPiece, ShapeKind } from './types';
import { tileRef } from './tiles';

export function isTowerShape(shape: ShapeKind): boolean {
	return shape === 'rounded' || shape === 'chamfered' || shape === 'tapered' || shape === 'sail';
}

const UV: Vec2[] = [[0, 1], [1, 1], [1, 0], [0, 0]];
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Continuous perimeter lofts, in metres. No grid stair-steps on curved or diagonal walls. */
export function buildTower(spec: BuildingSpec): BuildingModel {
	const width = spec.nx * spec.bay, depth = spec.nz * spec.bay;
	const height = spec.groundHeight + (spec.floors - 1) * spec.floorHeight;
	const rounded = spec.shape === 'rounded';
	// Clockwise in the XZ plane: bottom-left, bottom-right, top-right walls face outward.
	const outline: Vec2[] = rounded
		? Array.from({ length: 24 }, (_, i): Vec2 => [Math.cos(i * Math.PI / 12), Math.sin(i * Math.PI / 12)])
		: [[-0.72, -1], [0.72, -1], [1, -0.72], [1, 0.72], [0.72, 1], [-0.72, 1], [-1, 0.72], [-1, -0.72]];
	outline.reverse();
	const sloped = spec.floors >= 6 && (spec.shape === 'sail' || (rounded && spec.roof === 'shed'));
	const floorY = (f: number): number => f === 0 ? 0 : spec.groundHeight + (f - 1) * spec.floorHeight;
	const ring = (f: number): Vec3[] => outline.map(([x, z]): Vec3 => {
		const t = f / spec.floors;
		const scale = spec.shape === 'tapered' ? 1 - 0.4 * t : spec.shape === 'sail' ? 1 - 0.3 * Math.sin(t * Math.PI / 2) : 1;
		const y = f === spec.floors && sloped ? height - (x + 1) * Math.min(height * 0.07, spec.floorHeight * 1.8) : floorY(f);
		return [x * width / 2 * scale, y, z * depth / 2 * scale];
	});
	const facades: FacadeRun[] = [], pieces: ModelPiece[] = [], hull: ModelPiece[] = [];
	const add = (target: ModelPiece[], corners: Vec3[], kind: 'trim' | 'roof_flat' | 'curtain', maxLod: 0 | 1 | 2, tag: 'trim' | 'roof' = 'trim'): void => {
		target.push({ corners, uvs: corners.length === 3 ? [[0, 1], [1, 1], [0.5, 0]] : UV, tile: tileRef(kind, spec.palette), tag, maxLod });
	};
	// The sloping crown occupies the final four storeys; ordinary windows below it stay level.
	const levels = Array.from({ length: spec.floors + 1 }, (_, f) => f).filter(f => !sloped || f <= spec.floors - 4 || f === spec.floors);
	const rings = levels.map(ring);
	for (let side = 0; side < outline.length; side++) {
		const next = (side + 1) % outline.length;
		const a = rings[0][side], b = rings[0][next];
		const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
		const along: Vec3 = [(b[0] - a[0]) / length, 0, (b[2] - a[2]) / length];
		const normal: Vec3 = [-along[2], 0, along[0]];
		const bays = Math.max(1, Math.round(length / spec.bay));
		const run: FacadeRun = { id: side, origin: a, along, normal, bays, bayWidth: length / bays, front: normal[2] < -0.5, rows: [] };
		for (let k = 0; k < rings.length - 1; k++) {
			const c = rings[k][side], d = rings[k][next], e = rings[k + 1][next], f = rings[k + 1][side];
			const ground = k === 0;
			const kind = ground ? (run.front ? 'shop_glass' : 'curtain') : levels[k] % 6 === 5 ? 'curtain_band' : 'curtain';
			run.rows.push({ y0: c[1], height: Math.max(e[1] - d[1], f[1] - c[1]), corners: [c, d, e, f], tiles: Array.from({ length: bays }, (_, bay) => tileRef(ground && run.front && bay === Math.floor(bays / 2) ? 'shop_door' : kind, spec.palette)) });
			// Real projecting slab edges catch sunlight and cast a readable horizontal highlight.
			if (!ground) {
				const offset = (p: Vec3): Vec3 => [p[0] + normal[0] * 0.04, p[1], p[2] + normal[2] * 0.04];
				add(pieces, [offset([c[0], c[1] - 0.05, c[2]]), offset([d[0], d[1] - 0.05, d[2]]), offset(d), offset(c)], 'trim', levels[k] % 3 === 0 ? 1 : 0);
			}
		}
		facades.push(run);
		// Keep several loft sections at distance: a sail must not turn into a rectangular box at LOD2.
		const coarse = [0, ...levels.map((f, i) => f % 8 === 0 && i > 0 && i < rings.length - 1 ? i : -1).filter(i => i > 0), rings.length - 1];
		for (let k = 0; k < coarse.length - 1; k++) {
			const lo = rings[coarse[k]], hi = rings[coarse[k + 1]];
			add(hull, [lo[side], lo[next], hi[next], hi[side]], 'curtain', 2);
		}
		// Narrow metal corner seams follow the loft; their width is physical, independent of tower height.
		for (let k = 0; k < rings.length - 1; k++) {
			const lo = rings[k], hi = rings[k + 1];
			const offset = (p: Vec3): Vec3 => [p[0] + normal[0] * 0.035, p[1], p[2] + normal[2] * 0.035];
			add(pieces, [offset(lo[side]), offset(mix(lo[side], lo[next], Math.min(0.06 / length, 0.1))), offset(mix(hi[side], hi[next], Math.min(0.06 / length, 0.1))), offset(hi[side])], 'trim', 1);
		}
	}
	const top = rings[rings.length - 1];
	const center: Vec3 = [0, top.reduce((n, p) => n + p[1], 0) / top.length, 0];
	for (let i = 0; i < top.length; i++) {
		// This perimeter gives upward normals on the cap.
		add(pieces, [center, top[i], top[(i + 1) % top.length]], 'roof_flat', 2, 'roof');
	}
	// A rooftop landing pad is a separate plane with metric markings, never stretched over roof triangles.
	if (rounded && spec.floors >= 20) {
		const pad = Math.min(width,depth)*.31;
		const yAt = (x:number):number => sloped ? height - (x/(width/2)+1)*Math.min(height*.07,spec.floorHeight*1.8)+.08 : height+.08;
		pieces.push({ corners:[[-pad,yAt(-pad),-pad],[-pad,yAt(-pad),pad],[pad,yAt(pad),pad],[pad,yAt(pad),-pad]],
			uvs:UV,tile:tileRef('helipad',spec.palette),tag:'roof',maxLod:1 });
	}

	hull.push(...pieces.filter(p => p.tag === 'roof'));
	return { spec, width, depth, height: height + (rounded && !sloped && spec.floors >= 20 ? .08 : 0), facades, pieces, hull, volumes: [{ x0: -width / 2, x1: width / 2, z0: -depth / 2, z1: depth / 2, height }] };
}
