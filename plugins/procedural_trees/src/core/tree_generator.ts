import type { Branch, MeshData, TreeLod, TreeParams } from './types';
import { MeshBuilder, countTriangles, footprintWidth, translateMesh } from './mesh_builder';
import { Rng } from './rng';
import { growSkeleton } from './skeleton';
import { addBranchTube } from './tube_mesh';
import { addFoliage } from './foliage';
import { buildPalm } from './palm';
import { BARK_UV } from './uv_layout';

/** Triangle budget multipliers for LOD0, LOD1, LOD2. */
const LOD_BUDGET_SCALE: number[] = [1, 0.5, 0.25];
const SOLVER_STEPS = 9;
const MIN_QUALITY = 0.05;

interface RawTree {
	trunk: MeshData;
	foliage: MeshData;
	triangles: number;
}

function sidesForLevel(p: TreeParams, level: number, quality: number): number {
	const base: number = p.trunkSides - 2 * level - (quality < 0.4 ? 1 : 0);
	return Math.max(3, Math.round(base));
}

/** One deterministic build at a given quality (1 = full detail). */
export function buildTree(p: TreeParams, quality: number): RawTree {
	if (p.leafKind === 'palm' || p.foliageStyle === 'fronds') return buildPalm(p, quality);
	const branches: Branch[] = growSkeleton(p, quality, new Rng(p.seed));

	const trunkBuilder: MeshBuilder = new MeshBuilder();
	for (const branch of branches) {
		const indices = branch.points.map((_, index) => index).filter(index => p.variant === 'stylized' || quality >= 0.2 || index % 2 === 0 || index === branch.points.length - 1);
		const simplified = { ...branch, points: indices.map(index => branch.points[index]), radii: indices.map(index => branch.radii[index]) };
		addBranchTube(trunkBuilder, simplified, sidesForLevel(p, branch.level, quality), BARK_UV);
	}

	const foliageBuilder: MeshBuilder = new MeshBuilder();
	addFoliage(foliageBuilder, branches, p, quality, new Rng(p.seed + 7919));

	const trunk: MeshData = trunkBuilder.toData();
	const foliage: MeshData = foliageBuilder.toData();
	return { trunk, foliage, triangles: countTriangles(trunk) + countTriangles(foliage) };
}

/** Finds the highest quality whose triangle count fits the budget. */
export function fitToBudget(p: TreeParams, budget: number): TreeLod {
	const full: RawTree = buildTree(p, 1);
	if (full.triangles <= budget) return { ...full, quality: 1, withinBudget: true };

	let lo: number = MIN_QUALITY;
	let hi = 1;
	let best: RawTree = buildTree(p, lo);
	let bestQuality: number = lo;
	for (let i = 0; i < SOLVER_STEPS; i++) {
		const mid: number = (lo + hi) / 2;
		const candidate: RawTree = buildTree(p, mid);
		if (candidate.triangles <= budget) {
			best = candidate;
			bestQuality = mid;
			lo = mid;
		} else {
			hi = mid;
		}
	}
	return { ...best, quality: bestQuality, withinBudget: best.triangles <= budget };
}

/** LOD0 at the full budget, extra LODs at 50% / 25%, sharing an origin unless spreadLods is enabled. */
export function generateTreeSet(p: TreeParams): TreeLod[] {
	const lodCount: number = Math.max(1, Math.min(3, Math.round(p.lodCount)));
	const lods: TreeLod[] = [];
	let spacing = 0;
	for (let i = 0; i < lodCount; i++) {
		const lod: TreeLod = fitToBudget(p, Math.round(p.maxTriangles * LOD_BUDGET_SCALE[i]));
		if (i === 0) {
			const width: number = Math.max(footprintWidth(lod.trunk), footprintWidth(lod.foliage));
			spacing = width * 1.25 + p.height * 0.1;
			lods.push(lod);
			continue;
		}
		const offset: [number, number, number] = [p.spreadLods ? spacing * i : 0, 0, 0];
		lods.push({
			...lod,
			trunk: translateMesh(lod.trunk, offset),
			foliage: translateMesh(lod.foliage, offset),
		});
	}
	return lods;
}
