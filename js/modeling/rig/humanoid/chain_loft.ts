import { MeshSpec } from './humanoid_types';
import { ChainBone, Ring, chainWeights, loftRings, mergeMeshes, ringAxes } from './loft';
import { Vec3, add, lerp, length, normalize, scale, sub } from './vec';

/** Cross section half extents at a position t along the whole chain (0 = head of first bone, 1 = tail of last) */
export interface Station {
	t: number
	ru: number
	rv: number
}

export interface ChainLoftSpec {
	name: string
	bones: ChainBone[]
	/** Sorted by t. t outside of [0, 1] extrapolates along the first and last bone. */
	stations: Station[]
	up_hint: Vec3
}

export interface LoftSettings {
	sides: number
	blend: number
	/** Rigid boxes per bone instead of a continuous skinned surface */
	rigid: boolean
	/** Add intermediate rings in the middle of every bone */
	mid_rings: boolean
}

interface ChainGeometry {
	lengths: number[]
	starts: number[]
	total: number
	directions: Vec3[]
}

function chainGeometry(bones: ChainBone[]): ChainGeometry {
	const lengths: number[] = bones.map((b: ChainBone) => Math.max(1e-6, length(sub(b.tail, b.head))));
	const starts: number[] = [];
	let total: number = 0;
	for (const l of lengths) {
		starts.push(total);
		total += l;
	}
	return { lengths, starts, total, directions: bones.map((b: ChainBone) => normalize(sub(b.tail, b.head))) };
}

function pointAt(bones: ChainBone[], geometry: ChainGeometry, t: number): {position: Vec3, tangent: Vec3, bone: number} {
	const s: number = t * geometry.total;
	let index: number = bones.length - 1;
	for (let i: number = 0; i < bones.length; i++) {
		if (s <= geometry.starts[i] + geometry.lengths[i]) { index = i; break; }
	}
	const local: number = (s - geometry.starts[index]) / geometry.lengths[index];
	return {
		position: lerp(bones[index].head, bones[index].tail, local),
		tangent: geometry.directions[index],
		bone: index,
	};
}

function radiusAt(stations: Station[], t: number): [number, number] {
	if (t <= stations[0].t) return [stations[0].ru, stations[0].rv];
	const last: Station = stations[stations.length - 1];
	if (t >= last.t) return [last.ru, last.rv];
	for (let i: number = 0; i < stations.length - 1; i++) {
		const a: Station = stations[i];
		const b: Station = stations[i + 1];
		if (t >= a.t && t <= b.t) {
			const f: number = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
			return [a.ru + (b.ru - a.ru) * f, a.rv + (b.rv - a.rv) * f];
		}
	}
	return [last.ru, last.rv];
}

/**
 * Lofts a mesh along a chain of bones. Stations describe the cross sections, weights are derived from the chain.
 */
export function buildChainLoft(spec: ChainLoftSpec, settings: LoftSettings): MeshSpec {
	const { bones, stations } = spec;
	const geometry: ChainGeometry = chainGeometry(bones);
	const first_t: number = stations[0].t;
	const last_t: number = stations[stations.length - 1].t;

	const makeRing = (t: number, tangent_override?: Vec3, weights_override?: Record<string, number>): Ring => {
		// extrapolate beyond the ends along the end bones
		let position: Vec3;
		let tangent: Vec3;
		if (t < 0) {
			tangent = geometry.directions[0];
			position = add(bones[0].head, scale(tangent, t * geometry.total));
		} else if (t > 1) {
			tangent = geometry.directions[bones.length - 1];
			position = add(bones[bones.length - 1].tail, scale(tangent, (t - 1) * geometry.total));
		} else {
			const p = pointAt(bones, geometry, t);
			position = p.position;
			tangent = p.tangent;
		}
		tangent = tangent_override ?? tangent;
		const [axis_u, axis_v]: [Vec3, Vec3] = ringAxes(tangent, spec.up_hint);
		const [ru, rv]: [number, number] = radiusAt(stations, t);
		return {
			center: position,
			axis_u,
			axis_v,
			radius_u: ru,
			radius_v: rv,
			weights: weights_override ?? chainWeights(bones, position, settings.blend),
		};
	};

	if (settings.rigid) {
		const parts: MeshSpec[] = bones.map((bone: ChainBone, i: number) => {
			const t0: number = geometry.starts[i] / geometry.total;
			const t1: number = (geometry.starts[i] + geometry.lengths[i]) / geometry.total;
			// the first and last bone also cover the extrapolated ends
			const a: number = i == 0 ? Math.min(t0, first_t) : t0;
			const b: number = i == bones.length - 1 ? Math.max(t1, last_t) : t1;
			const rigid_weights: Record<string, number> = { [bone.id]: 1 };
			return loftRings(
				spec.name + '_' + bone.id,
				[makeRing(a, geometry.directions[i], rigid_weights), makeRing(b, geometry.directions[i], rigid_weights)],
				settings.sides
			);
		});
		return mergeMeshes(spec.name, parts);
	}

	// continuous surface: rings at stations, optional mid rings, pairs around joints so bends keep their volume
	const ts: Set<number> = new Set();
	for (const s of stations) ts.add(Math.round(s.t * 1e6) / 1e6);
	for (let i: number = 0; i < bones.length; i++) {
		const t0: number = geometry.starts[i] / geometry.total;
		const t1: number = (geometry.starts[i] + geometry.lengths[i]) / geometry.total;
		if (settings.mid_rings) ts.add(Math.round(((t0 + t1) / 2) * 1e6) / 1e6);
		if (i > 0) {
			const delta: number = 0.12 * Math.min(geometry.lengths[i - 1], geometry.lengths[i]) / geometry.total;
			ts.add(Math.round((t0 - delta) * 1e6) / 1e6);
			ts.add(Math.round((t0 + delta) * 1e6) / 1e6);
		}
	}
	const sorted: number[] = Array.from(ts).filter((t: number) => t >= first_t - 1e-9 && t <= last_t + 1e-9).sort((a: number, b: number) => a - b);
	// drop the ring at the exact joint when the pair around it exists, rings would be too close otherwise
	const rings: Ring[] = sorted.map((t: number) => {
		let tangent: Vec3 | undefined;
		for (let i: number = 1; i < bones.length; i++) {
			const joint_t: number = geometry.starts[i] / geometry.total;
			const reach: number = 0.13 * Math.min(geometry.lengths[i - 1], geometry.lengths[i]) / geometry.total;
			if (Math.abs(t - joint_t) <= reach + 1e-9) {
				tangent = normalize(add(geometry.directions[i - 1], geometry.directions[i]));
			}
		}
		return makeRing(t, tangent);
	});
	return loftRings(spec.name, rings, settings.sides);
}
