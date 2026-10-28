import type { Vec3 } from '../core/types';
import type { NetworkSettings, RoadDocument, RoadNetwork, RoadProfile, RoadSegment, SegmentData } from '../core/model';
import type { RoadLibrary } from '../core/library_types';
import { GenerationCache, generateNetwork } from '../core/generate';
import type { GenerateResult } from '../core/generate';
import type { GenerationContext } from '../core/context';
import { applyDraft, counterIds, autoIntersect } from '../core/network_edit';
import type { DraftAnchor, IdFactory } from '../core/network_edit';
import { addNode, addSegment, cloneNetwork, createNetwork } from '../core/network';
import { NETWORK_KEY } from './ids';
import { emptyDocument, hasNetwork, readStoredDocument, writeStoredDocument } from './document';
import { migrateLegacyRoad } from './migrate';
import { readNetwork, writeNetwork } from './network_mesh';
import type { WriteResult } from './network_mesh';
import { LiveSurface, createSurfaceMaterials, disposeSurfaceMaterials } from './live_surface';
import type { SurfaceMaterials } from './live_surface';
import { MaterialPool, makeRoadBody } from './live_render';
import { ProceduralTreeProvider } from './tree_provider';
import { listen } from './events';
import type { Disposable } from './events';
import { bakeRoad } from './bake';
import { setSelectionMode } from './bb_access';

export interface LiveState {
	surface: LiveSurface;
	cache: GenerationCache;
	signature: string;
	result: GenerateResult | null;
	error: string;
	timer: number | null;
}

export type Mutation = (network: RoadNetwork, ids: IdFactory) => RoadNetwork | void;
export type ChangeListener = (mesh: Mesh | null, state: LiveState | undefined, selection: boolean) => void;

const DEBOUNCE_MS: number = 35;

/** Keeps every road network in the project generated, displayed and editable. */
export class LiveRoads {
	readonly states: Map<Mesh, LiveState> = new Map();
	readonly ready: Promise<RoadLibrary>;
	library: RoadLibrary | null = null;
	readonly trees: ProceduralTreeProvider;
	private pool: MaterialPool | null = null;
	private readonly materials: SurfaceMaterials = createSurfaceMaterials();
	private readonly listeners: Disposable[] = [];
	private disposed: boolean = false;

	constructor(
		load: () => Promise<RoadLibrary>,
		private readonly changed: ChangeListener,
	) {
		this.trees = new ProceduralTreeProvider((): void => this.scan(true));
		this.ready = load().then((library: RoadLibrary): RoadLibrary => {
			if (this.disposed) return library;
			this.library = library;
			this.pool = new MaterialPool(library, (key: string) => this.trees.atlas(key), (): void => Canvas.updateAll());
			this.scan();
			return library;
		});
		this.subscribe();
	}

	private subscribe(): void {
		const schedule = ({ element }: { element: Mesh }): void => this.schedule(element);
		this.listeners.push(
			listen(Mesh.preview_controller, 'setup update_geometry update_faces', schedule),
			listen(Mesh.preview_controller, 'update_selection', ({ element }: { element: Mesh }): void => this.states.get(element)?.surface.refreshSelection()),
			listen(Mesh.preview_controller, 'remove', ({ element }: { element: Mesh }): void => this.clear(element)),
			listen(Blockbench, 'finished_edit undo redo select_project load_project', (): void => this.scan()),
			listen(Blockbench, 'update_selection', (): void => this.notify(true)),
			listen(Blockbench, 'unselect_project', (): void => {
				for (const mesh of [...this.states.keys()]) this.clear(mesh);
			}),
		);
	}

	private notify(selection: boolean = false): void {
		const mesh: Mesh | null = this.selected();
		this.changed(mesh, mesh ? this.states.get(mesh) : undefined, selection);
	}

	/** The single selected road network, if there is one. */
	selected(): Mesh | null {
		return Mesh.selected.length === 1 && hasNetwork(Mesh.selected[0]) ? Mesh.selected[0] : null;
	}

	/** The mesh new roads are drawn into: the selected network, else the only one in the project. */
	target(): Mesh | null {
		const picked: Mesh | null = this.selected();
		if (picked) return picked;
		const all: Mesh[] = Mesh.all.filter(hasNetwork);
		return all.length === 1 ? all[0] : null;
	}

	/** Reads (and migrates, when needed) the document of a control mesh. */
	documentOf(mesh: Mesh): RoadDocument {
		return readStoredDocument(mesh) ?? migrateLegacyRoad(mesh) ?? emptyDocument();
	}

	networkOf(mesh: Mesh): RoadNetwork {
		return readNetwork(mesh, this.documentOf(mesh));
	}

	context(): GenerationContext {
		if (!this.library) throw new Error('The road library is still loading.');
		return { library: this.library, trees: this.trees };
	}

	private signature(mesh: Mesh, extra: string): string {
		const edges: string[] = [];
		for (const face of Object.values(mesh.faces)) if (face.vertices.length === 2) edges.push(face.vertices.join('|'));
		return JSON.stringify([mesh.vertices, edges, (mesh as unknown as Record<string, string>)[NETWORK_KEY], this.trees.revision, extra]);
	}

	private clear(mesh: Mesh): void {
		const state: LiveState | undefined = this.states.get(mesh);
		if (!state) return;
		if (state.timer !== null) clearTimeout(state.timer);
		state.surface.dispose();
		this.states.delete(mesh);
	}

	scan(force: boolean = false): void {
		if (this.disposed) return;
		for (const mesh of [...this.states.keys()]) if (!Mesh.all.includes(mesh) || !hasNetwork(mesh)) this.clear(mesh);
		for (const mesh of Mesh.all) if (hasNetwork(mesh)) this.schedule(mesh, force);
		this.notify();
	}

	private schedule(mesh: Mesh, force: boolean = false): void {
		if (this.disposed || !hasNetwork(mesh)) {
			this.clear(mesh);
			return;
		}
		const state: LiveState | undefined = this.states.get(mesh);
		if (!state) {
			this.update(mesh, undefined, force);
			return;
		}
		if (state.timer !== null) return;
		state.timer = window.setTimeout((): void => {
			state.timer = null;
			this.update(mesh, undefined, force);
		}, DEBOUNCE_MS);
	}

	/** Regenerates one road network. `override` shows a change without storing it (live previews). */
	update(mesh: Mesh, override?: RoadNetwork, force: boolean = false): void {
		if (this.disposed || !this.library || !this.pool || !Mesh.all.includes(mesh) || !hasNetwork(mesh)) return;
		let state: LiveState | undefined = this.states.get(mesh);
		if (state && !state.surface.valid()) {
			this.clear(mesh);
			state = undefined;
		}
		if (!state) {
			state = { surface: new LiveSurface(mesh, this.materials), cache: new GenerationCache(), signature: '', result: null, error: '', timer: null };
			this.states.set(mesh, state);
		}
		const signature: string = this.signature(mesh, override ? JSON.stringify([...override.segments.values()]) + JSON.stringify([...override.profiles.values()]) : '');
		if (!force && !override && signature === state.signature && state.result) {
			this.notify();
			return;
		}
		try {
			const network: RoadNetwork = override ?? this.networkOf(mesh);
			const result: GenerateResult = generateNetwork(network, this.context(), state.cache);
			state.surface.show(makeRoadBody(result.parts, this.pool));
			state.result = result;
			state.signature = override ? '' : signature;
			state.error = '';
		} catch (error) {
			state.surface.showControl();
			state.result = null;
			state.signature = '';
			state.error = (error as Error).message;
			console.error('Roadscape', error);
		}
		this.notify();
	}

	/** Shows a change without touching the project, so sliders can feel live. */
	preview(mesh: Mesh, mutate: Mutation): void {
		const network: RoadNetwork = cloneNetwork(this.networkOf(mesh));
		const replaced: RoadNetwork | void = mutate(network, counterIds('~p'));
		this.update(mesh, replaced ?? network);
	}

	/** Applies an edit to a road network as one undo step. */
	edit(mesh: Mesh, label: string, mutate: Mutation): WriteResult {
		const network: RoadNetwork = cloneNetwork(this.networkOf(mesh));
		const replaced: RoadNetwork | void = mutate(network, counterIds('~e'));
		const next: RoadNetwork = replaced ?? network;
		Undo.initEdit({ elements: [mesh], selection: true } as never);
		try {
			const written: WriteResult = writeNetwork(mesh, next);
			writeStoredDocument(mesh, written.doc);
			Undo.finishEdit(label);
			Canvas.updateView({ elements: [mesh], element_aspects: { geometry: true, faces: true }, selection: true } as never);
			this.update(mesh, undefined, true);
			return written;
		} catch (error) {
			Undo.cancelEdit(true);
			throw error;
		}
	}

	/** Creates a control mesh holding `network` as one undo step. */
	createMesh(network: RoadNetwork, label: string): Mesh {
		Undo.initEdit({ outliner: true, elements: [], selection: true } as never);
		const mesh: Mesh = new Mesh({ name: 'Roadscape network', vertices: {}, origin: [0, 0, 0] } as never);
		try {
			mesh.init();
			const written: WriteResult = writeNetwork(mesh, network);
			writeStoredDocument(mesh, written.doc);
			unselectAllElements();
			mesh.select();
			setSelectionMode('vertex');
			Undo.finishEdit(label, { outliner: true, elements: [mesh], selection: true } as never);
			Canvas.updateView({ elements: [mesh], element_aspects: { geometry: true, faces: true }, selection: true } as never);
			this.update(mesh, undefined, true);
			return mesh;
		} catch (error) {
			const aspects = (Undo as unknown as { current_save: { aspects: { elements: Mesh[] } } }).current_save.aspects;
			aspects.elements.push(...[mesh].filter((m: Mesh): boolean => Outliner.elements.includes(m)));
			Undo.cancelEdit(true);
			throw error;
		}
	}

	/** Applies a finished drawing the way a city builder would: snapping, splitting and connecting. */
	commitDraft(target: Mesh | null, anchors: DraftAnchor[], data: Partial<SegmentData>, closed: boolean, radius: number, settings: Partial<NetworkSettings>, profiles: Map<string, RoadProfile>): Mesh {
		if (anchors.length < 2) throw new Error('Click at least two points.');
		if (target) {
			this.edit(target, 'Draw road', (network: RoadNetwork, ids: IdFactory): RoadNetwork => {
				carryProfiles(network, data.profile, profiles);
				return applyDraft(network, anchors, ids, data, closed, radius).network;
			});
			return target;
		}
		const network: RoadNetwork = createNetwork({ ...settings, defaultProfile: data.profile ?? settings.defaultProfile });
		carryProfiles(network, data.profile, profiles);
		const result = applyDraft(network, anchors, counterIds('~d'), data, closed, radius);
		return this.createMesh(result.network, 'Draw road');
	}

	/** Splits and joins every place where roads of this network meet or cross. */
	autoSetup(mesh: Mesh): number {
		let created: number = 0;
		this.edit(mesh, 'Auto-setup intersections', (network: RoadNetwork, ids: IdFactory): void => {
			created = autoIntersect(network, ids).created.length;
		});
		return created;
	}

	/** Builds a displayable body for generated parts, or null while the library is still loading. */
	body(result: GenerateResult): THREE.Group | null {
		return this.pool ? makeRoadBody(result.parts, this.pool) : null;
	}

	/** Result of the last build, for the panel's statistics. */
	resultOf(mesh: Mesh | null): GenerateResult | null {
		return mesh ? (this.states.get(mesh)?.result ?? null) : null;
	}

	async bake(mesh: Mesh): Promise<void> {
		const library: RoadLibrary = await this.ready;
		const owner: typeof Project = Project;
		const before: string = this.signature(mesh, '');
		let result: GenerateResult = generateNetwork(this.networkOf(mesh), this.context(), this.states.get(mesh)?.cache ?? null);
		for (let waited: number = 0; result.report.treesPending && waited < 120; waited++) {
			await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 100));
			result = generateNetwork(this.networkOf(mesh), this.context(), this.states.get(mesh)?.cache ?? null);
		}
		if (owner !== Project || !Mesh.all.includes(mesh) || before !== this.signature(mesh, '')) throw new Error('The road changed while baking. Try again.');
		bakeRoad(result, library, (key: string) => this.trees.atlas(key), mesh);
	}

	dispose(): void {
		this.disposed = true;
		for (const l of this.listeners) l.delete();
		for (const mesh of [...this.states.keys()]) this.clear(mesh);
		this.pool?.dispose();
		this.trees.dispose();
		disposeSurfaceMaterials(this.materials);
	}
}

/** A starting network used by presets: a straight road of a given length. */
export function straightRoad(from: Vec3, to: Vec3, profile: string): RoadNetwork {
	const network: RoadNetwork = createNetwork({ defaultProfile: profile });
	addNode(network, 'a', from);
	addNode(network, 'b', to);
	addSegment(network, 'a', 'b', { profile });
	return network;
}

export type { RoadSegment };

/** Makes sure a profile edited before any road existed travels with the road that uses it. */
function carryProfiles(network: RoadNetwork, id: string | undefined, profiles: Map<string, RoadProfile>): void {
	const profile: RoadProfile | undefined = id ? profiles.get(id) : undefined;
	if (id && profile && !profile.builtin && !network.profiles.has(id)) network.profiles.set(id, profile);
}
