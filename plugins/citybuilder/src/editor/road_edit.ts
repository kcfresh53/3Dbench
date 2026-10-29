import type { RoadDocument, RoadNetwork, RoadProfile, RoadSegment, Structure } from '../../../roadscape/src/core/model';
import { buildIndex, resolveProfileData } from '../../../roadscape/src/core/network';
import { counterIds } from '../../../roadscape/src/core/network_edit';
import { BUILTIN_PROFILES } from '../../../roadscape/src/core/profile_library';
import { resolveProfile } from '../../../roadscape/src/core/profile_resolve';
import { emptyDocument, hasNetwork, readStoredDocument, writeStoredDocument } from '../../../roadscape/src/editor/document';
import { migrateLegacyRoad } from '../../../roadscape/src/editor/migrate';
import { readNetwork, writeNetwork } from '../../../roadscape/src/editor/network_mesh';
import type { CityState } from '../core/city/state';
import type { Roundabout } from '../core/city/settings';
import { DEFAULT_ROAD_PAINT, paintRoadType } from '../core/roads/road_paint';
import type { RegionTest, RoadChange, RoadPaintOptions } from '../core/roads/road_paint';
import { DEFAULT_ROUNDABOUT, makeRoundabout } from '../core/roads/roundabout';
import type { RoundaboutOptions } from '../core/roads/roundabout';
import type { Vec3 } from '../core/types';
import type { CityStore } from './store';

/** A road point seen from the city: where it is in city metres and how many roads meet there. */
export interface RoadPoint {
	mesh: Mesh;
	id: string;
	x: number;
	y: number;
	z: number;
	degree: number;
}

export interface ProfileChoice {
	id: string;
	name: string;
}

/** How a Roadscape mesh's own space relates to city metres. */
interface MeshFrame {
	toCity: (p: Vec3) => Vec3;
	/** Metres per length unit of the mesh's own space. */
	metresPerUnit: number;
}

function frameOf(mesh: Mesh, cityUnits: number): MeshFrame {
	mesh.mesh.updateWorldMatrix(true, false);
	const matrix: THREE.Matrix4 = mesh.mesh.matrixWorld.clone();
	const scale: THREE.Vector3 = mesh.mesh.getWorldScale(new THREE.Vector3());
	const tmp: THREE.Vector3 = new THREE.Vector3();
	return {
		toCity: (p: Vec3): Vec3 => {
			tmp.set(p[0], p[1], p[2]).applyMatrix4(matrix);
			return [tmp.x / cityUnits, tmp.y / cityUnits, tmp.z / cityUnits];
		},
		metresPerUnit: (Math.abs(scale.x) + Math.abs(scale.y) + Math.abs(scale.z)) / 3 / cityUnits,
	};
}

function documentOf(mesh: Mesh): RoadDocument {
	return readStoredDocument(mesh) ?? migrateLegacyRoad(mesh) ?? emptyDocument();
}

/**
 * The Blockbench side of editing roads from the city: finds road points, builds roundabouts and repaints
 * road types, each as one undo step. The geometry work lives in `core/roads`; this only converts between
 * a mesh's space and city metres and writes the result back.
 */
export class RoadEditor {
	private cache: { key: string; points: RoadPoint[] } | null = null;
	private choices: { key: string; list: ProfileChoice[] } | null = null;

	constructor(private readonly store: CityStore) {}

	private meshes(): Mesh[] {
		return Mesh.all.filter(hasNetwork);
	}

	/** Every road point in the project, in city metres. Reused until the roads change. */
	points(state: CityState): RoadPoint[] {
		const key: string = `${this.store.roadSignature}|${this.store.editRevision}|${state.settings.unitsPerMeter}`;
		if (this.cache?.key === key) return this.cache.points;
		const points: RoadPoint[] = [];
		for (const mesh of this.meshes()) {
			const network: RoadNetwork = readNetwork(mesh, documentOf(mesh));
			const index = buildIndex(network);
			const frame: MeshFrame = frameOf(mesh, state.settings.unitsPerMeter);
			for (const node of network.nodes.values()) {
				const p: Vec3 = frame.toCity(node.position);
				points.push({ mesh, id: node.id, x: p[0], y: p[1], z: p[2], degree: index.incident.get(node.id)?.length ?? 0 });
			}
		}
		this.cache = { key, points };
		return points;
	}

	/** The road point nearest a ground position, if one lies within `reach` metres. Junctions win ties. */
	nearest(state: CityState, x: number, z: number, reach: number): RoadPoint | null {
		let best: RoadPoint | null = null;
		let bestScore: number = Infinity;
		for (const p of this.points(state)) {
			if (p.degree === 0) continue;
			const d: number = Math.hypot(p.x - x, p.z - z);
			const score: number = d - (p.degree >= 3 ? reach * 0.25 : 0);
			if (d <= reach && score < bestScore) {
				best = p;
				bestScore = score;
			}
		}
		return best;
	}

	/** Road types the user can paint: the built-in library plus anything made in this project. */
	profileChoices(): ProfileChoice[] {
		const key: string = this.store.roadSignature;
		if (this.choices?.key === key) return this.choices.list;
		const seen: Map<string, string> = new Map(BUILTIN_PROFILES.map((p: RoadProfile): [string, string] => [p.id, p.name]));
		for (const mesh of this.meshes()) {
			for (const [id, profile] of Object.entries(documentOf(mesh).profiles)) if (!seen.has(id)) seen.set(id, profile.name);
		}
		const list: ProfileChoice[] = [...seen.entries()].map(([id, name]: [string, string]): ProfileChoice => ({ id, name }));
		this.choices = { key, list };
		return list;
	}

	/**
	 * Builds a roundabout at a road point. The road edit and the city's record of the island share one
	 * undo step. Returns the roundabout as stored in the city.
	 */
	roundabout(state: CityState, point: RoadPoint, radiusMetres: number, profile: string, hand: RoundaboutOptions['hand']): Roundabout {
		const mesh: Mesh = point.mesh;
		const frame: MeshFrame = frameOf(mesh, state.settings.unitsPerMeter);
		const network: RoadNetwork = readNetwork(mesh, documentOf(mesh));
		const options: RoundaboutOptions = { ...DEFAULT_ROUNDABOUT, radius: radiusMetres / frame.metresPerUnit, profile: profile || 'auto', hand };
		this.store.history.begin();
		Undo.initEdit({ elements: [mesh], selection: true } as never);
		try {
			const result = makeRoundabout(network, point.id, options, counterIds('~rb'));
			const written = writeNetwork(mesh, network);
			writeStoredDocument(mesh, written.doc);
			const ring: RoadProfile = resolveProfileData(written.network, result.profile);
			const extent = resolveProfile(ring, written.network.settings.unitsPerMeter, written.network.settings.weather).extent;
			const reach: number = (Math.max(extent.left, extent.right) / written.network.settings.unitsPerMeter) * 1;
			const center: Vec3 = frame.toCity(result.center);
			const roundabout: Roundabout = { x: center[0], y: center[1], z: center[2], radius: radiusMetres, island: Math.max(1.5, radiusMetres - reach) };
			state.settings.roundabouts = [...state.settings.roundabouts.filter((r: Roundabout): boolean => Math.hypot(r.x - roundabout.x, r.z - roundabout.z) > 1), roundabout];
			this.store.history.commit('Build roundabout', { elements: [mesh], outliner: false, selection: true });
			Canvas.updateView({ elements: [mesh], element_aspects: { geometry: true, faces: true }, selection: true } as never);
			this.store.edited(0);
			return roundabout;
		} catch (error) {
			this.store.history.discard();
			Undo.cancelEdit(true);
			throw error;
		}
	}

	/** Changes the road type inside a region on every network that reaches it. One undo step. */
	paint(state: CityState, region: RegionTest, change: RoadChange, bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): { changed: number; split: number } {
		const jobs: Array<{ mesh: Mesh; network: RoadNetwork; frame: MeshFrame }> = [];
		const total = { changed: 0, split: 0 };
		for (const mesh of this.meshes()) {
			const frame: MeshFrame = frameOf(mesh, state.settings.unitsPerMeter);
			const network: RoadNetwork = readNetwork(mesh, documentOf(mesh));
			const options: RoadPaintOptions = { toCity: frame.toCity, metresPerUnit: frame.metresPerUnit, ...DEFAULT_ROAD_PAINT };
			const touches: boolean = [...network.nodes.values()].some((n): boolean => {
				const p: Vec3 = frame.toCity(n.position);
				return p[0] >= bounds.minX - 400 && p[0] <= bounds.maxX + 400 && p[2] >= bounds.minZ - 400 && p[2] <= bounds.maxZ + 400;
			});
			if (!touches) continue;
			const result = paintRoadType(network, region, change, counterIds('~pt'), options);
			if (result.changed === 0) continue;
			total.changed += result.changed;
			total.split += result.split;
			jobs.push({ mesh, network, frame });
		}
		if (jobs.length === 0) return total;
		const meshes: Mesh[] = jobs.map((j): Mesh => j.mesh);
		Undo.initEdit({ elements: meshes, selection: true } as never);
		try {
			for (const job of jobs) {
				const written = writeNetwork(job.mesh, job.network);
				writeStoredDocument(job.mesh, written.doc);
			}
			Undo.finishEdit(change.structure ? 'Paint road structure' : 'Paint road type', { elements: meshes, selection: true } as never);
			Canvas.updateView({ elements: meshes, element_aspects: { geometry: true, faces: true }, selection: true } as never);
			this.store.edited(0);
		} catch (error) {
			Undo.cancelEdit(true);
			throw error;
		}
		return total;
	}

	/** Structure names for the panel. */
	static readonly STRUCTURES: Array<{ id: Structure; label: string }> = [
		{ id: 'auto', label: 'Automatic' },
		{ id: 'ground', label: 'Ground' },
		{ id: 'bridge', label: 'Bridge' },
		{ id: 'tunnel', label: 'Tunnel' },
		{ id: 'air', label: 'Open span / jump' },
	];

	/** Segments of a mesh, for tests and diagnostics. */
	static segmentsOf(mesh: Mesh): RoadSegment[] {
		return [...readNetwork(mesh, documentOf(mesh)).segments.values()];
	}
}
