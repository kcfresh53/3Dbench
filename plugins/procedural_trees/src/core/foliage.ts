import type { Branch, TreeParams, Vec3 } from './types';
import { MeshBuilder } from './mesh_builder';
import { Rng } from './rng';
import { add, clamp, lerp, scale } from './math';
import { crownFactor } from './crown';
import { samplePath } from './skeleton';
import { addBlob, addCardCluster, addStylizedCardCluster, addConeTier } from './foliage_shapes';
import type { PathSample } from './skeleton';

function addClustersAlongBranch(
	mb: MeshBuilder,
	branch: Branch,
	p: TreeParams,
	quality: number,
	rng: Rng,
): void {
	const count: number = Math.max(1, Math.round(p.foliageDensity * quality));
	const size: number = (p.height * p.foliageSize) / 100;
	for (let j = 0; j < count; j++) {
		const t: number = lerp(p.foliageStart, 1, p.variant === 'stylized' ? (j + 1) / count : (j + 0.5 + rng.range(-0.2, 0.2)) / count);
		const sample: PathSample = samplePath(branch, t);
		const center: Vec3 = add(sample.position, scale(rng.unitVector(), size * 0.25));
		const clusterSize: number = size * rng.range(0.8, p.variant === 'stylized' ? 1.2 : 1.35);
		if (p.foliageStyle === 'blobs') {
			addBlob(mb, center, clusterSize, p.blobDetail, rng);
		} else if (p.variant === 'stylized') {
			addStylizedCardCluster(mb, center, clusterSize, Math.round(clamp(p.cardPlanes, 1, 3)), rng);
		} else {
			addCardCluster(mb, center, clusterSize, Math.max(1, Math.round(clamp(p.cardPlanes, 1, 3) * (0.4 + quality * 0.6))), rng);
		}
	}
}

/** Stacked open cones along the trunk: the cheapest believable conifer. */
function addTiers(mb: MeshBuilder, trunk: Branch, p: TreeParams, quality: number, rng: Rng): void {
	const tiers: number = Math.max(2, Math.round(p.foliageDensity * quality));
	const maxRadius: number = (p.height * p.foliageSize) / 100;
	const sides: number = quality < 0.4 ? 4 : clamp(p.trunkSides + 1, 4, 8);
	const reference: number = crownFactor(p.crownShape, p.foliageStart);
	const spanHeight: number = (trunk.length * (0.97 - p.foliageStart)) / tiers;

	for (let i = 0; i < tiers; i++) {
		const f: number = tiers === 1 ? 0 : i / (tiers - 1);
		const t: number = lerp(p.foliageStart, 0.97, f);
		const base: Vec3 = samplePath(trunk, t).position;
		const radius: number = maxRadius * clamp(crownFactor(p.crownShape, t) / reference, 0.15, 1.2);
		const height: number = spanHeight * 1.9 + radius * 0.5;
		const baseCenter: Vec3 = [base[0], base[1] - radius * 0.1, base[2]];
		const apex: Vec3 = [base[0], base[1] + height, base[2]];
		addConeTier(mb, baseCenter, apex, radius, sides, rng.range(0, Math.PI * 2), rng);
	}
}

/** Places foliage on terminal branches (or tiers on the trunk). */
export function addFoliage(
	mb: MeshBuilder,
	branches: Branch[],
	p: TreeParams,
	quality: number,
	rng: Rng,
): void {
	if (p.foliageStyle === 'none') return;
	if (p.foliageStyle === 'tiers') {
		addTiers(mb, branches[0], p, quality, rng);
		return;
	}
	if (p.variant === 'stylized') {
		for (const branch of branches) if (branch.level === p.branchLevels) addClustersAlongBranch(mb, branch, p, quality, rng);
		return;
	}
	if (p.foliageStyle === 'blobs' && p.branchLevels > 0) {
		for (const branch of branches.filter(b => b.level === 1)) {
			addClustersAlongBranch(mb, branch, p, quality, new Rng(p.seed + Math.round(branch.points[0][1] * 977)));
		}
		// Close the top of the crown around the leader instead of leaving a hole.
		for (const t of [0.8, 0.97]) addBlob(mb, samplePath(branches[0],t).position, p.height*p.foliageSize/100, p.blobDetail, rng);
		return;
	}
	for (const branch of branches) {
		if (branch.level === p.branchLevels || (p.branchLevels > 1 && branch.level === p.branchLevels - 1)) {
			addClustersAlongBranch(mb, branch, p, quality, new Rng(p.seed + Math.round(branch.points[0][0]*139 + branch.points[0][1]*977 + branch.points[0][2]*331)));
		}
	}
}
