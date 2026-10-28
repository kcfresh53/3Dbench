import type { NetworkSettings, NodeOptions, RoadNetwork, RoadProfile, RoadSegment, SegmentData, Structure } from '../core/model';
import { BUILTIN_PROFILES, builtinProfile } from '../core/profile_library';
import { forkProfile } from '../core/profile_edit';
import { createNetwork } from '../core/network';
import { applySettingsPatch, mergeSettings } from '../core/defaults';
import type { SettingsPatch } from '../core/defaults';
import type { GenerateResult } from '../core/generate';
import type { LiveRoads, LiveState } from './live_manager';
import { insertPoint, removePoint } from '../core/network_edit';
import type { IdFactory } from '../core/network_edit';
import { DrawTool } from './draw_tool';
import type { DrawHost, DrawOptions } from './draw_tool';
import { lookupProfile, selectedSegments } from './network_mesh';

export interface ProfileOption {
	id: string;
	name: string;
	custom: boolean;
}

export interface Stats {
	nodes: number;
	segments: number;
	triangles: number;
	budget: number;
	enforced: boolean;
	treesPending: boolean;
	warnings: string[];
	breakdown: Array<{ name: string; triangles: number }>;
}

/** Everything the panel shows, rebuilt whenever the selection or the road changes. */
export interface Snapshot {
	hasRoad: boolean;
	profileId: string;
	profile: RoadProfile;
	profiles: ProfileOption[];
	/** Number of segments in this network that use the shown profile. */
	usage: number;
	settings: NetworkSettings;
	selectedSegments: number;
	selectedNodes: number;
	segment: SegmentData | null;
	node: NodeOptions | null;
	stats: Stats | null;
	error: string;
}

export type ProfileEdit = (profile: RoadProfile) => RoadProfile;

function uniqueProfileId(known: Iterable<string>): string {
	const used: Set<string> = new Set(known);
	let n: number = 1;
	while (used.has(`custom-${n}`)) n++;
	return `custom-${n}`;
}

/** Runs a profile edit: built-in profiles are forked first so the library never changes. */
function applyProfileEdit(network: RoadNetwork, segments: RoadSegment[], baseId: string, edit: ProfileEdit, copy: boolean): string {
	const base: RoadProfile = lookupProfile(network, baseId) ?? (builtinProfile('street') as RoadProfile);
	let working: RoadProfile = base;
	if (base.builtin || copy) {
		const ids: string[] = [...network.profiles.keys(), ...BUILTIN_PROFILES.map((p: RoadProfile): string => p.id)];
		working = forkProfile(base, uniqueProfileId(ids), `${base.name.replace(/ \(custom\)$/, '')} (custom)`);
	}
	const next: RoadProfile = edit(working);
	next.builtin = false;
	network.profiles.set(next.id, next);
	if (next.id !== baseId) for (const s of segments) (network.segments.get(s.key) as RoadSegment).profile = next.id;
	return next.id;
}

/** Shared state of the plugin: the live roads, the drawing tool and the settings new roads start with. */
export class RoadSession implements DrawHost {
	readonly manager: LiveRoads;
	draw: DrawTool | null = null;
	drawOptions: DrawOptions = { height: 0, snap: 1, surface: false, connect: true };
	drawProfile: string = 'street';
	readonly draftProfileMap: Map<string, RoadProfile> = new Map();
	settingsForNew: Partial<NetworkSettings> = mergeSettings(undefined);
	message: ((text: string) => void) | null = null;

	constructor(manager: LiveRoads) {
		this.manager = manager;
	}

	// ---- DrawHost ----------------------------------------------------------------------

	options(): DrawOptions {
		return this.drawOptions;
	}

	segmentData(): Partial<SegmentData> {
		return { profile: this.drawProfile };
	}

	newSettings(): Partial<NetworkSettings> {
		return this.settingsForNew;
	}

	draftProfiles(): Map<string, RoadProfile> {
		return this.draftProfileMap;
	}

	status(message: string): void {
		this.message?.(message);
	}

	// ---- reading -----------------------------------------------------------------------

	snapshot(mesh: Mesh | null, state: LiveState | undefined): Snapshot {
		const draftNetwork: RoadNetwork = createNetwork(this.settingsForNew);
		for (const [id, p] of this.draftProfileMap) draftNetwork.profiles.set(id, p);
		const network: RoadNetwork = mesh ? this.manager.networkOf(mesh) : draftNetwork;
		const segments: RoadSegment[] = mesh ? selectedSegments(mesh, network) : [];
		const first: RoadSegment | undefined = segments[0];
		const profileId: string = first ? first.profile : mesh ? network.settings.defaultProfile : this.drawProfile;
		const profile: RoadProfile = lookupProfile(network, profileId) ?? (builtinProfile('street') as RoadProfile);
		const profiles: ProfileOption[] = [
			...BUILTIN_PROFILES.map((p: RoadProfile): ProfileOption => ({ id: p.id, name: p.name, custom: false })),
			...[...network.profiles.values()].filter((p: RoadProfile): boolean => !p.builtin).map((p: RoadProfile): ProfileOption => ({ id: p.id, name: p.name, custom: true })),
		];
		let usage: number = 0;
		for (const s of network.segments.values()) if (s.profile === profileId) usage++;
		const nodeIds: string[] = mesh ? mesh.getSelectedVertices() : [];
		const result: GenerateResult | null = state?.result ?? null;
		return {
			hasRoad: !!mesh,
			profileId,
			profile,
			profiles,
			usage,
			settings: network.settings,
			selectedSegments: segments.length,
			selectedNodes: nodeIds.length,
			segment: first ? { profile: first.profile, structure: first.structure, smooth: first.smooth, handleA: first.handleA, handleB: first.handleB } : null,
			node: nodeIds.length > 0 ? (network.nodes.get(nodeIds[0])?.options ?? null) : null,
			stats: result
				? {
						nodes: network.nodes.size,
						segments: network.segments.size,
						triangles: result.triangles,
						budget: network.settings.budget.maxTriangles,
						enforced: network.settings.budget.enforce,
						treesPending: result.report.treesPending,
						warnings: result.report.warnings,
						breakdown: Object.entries(result.breakdown)
							.map(([name, triangles]: [string, number]): { name: string; triangles: number } => ({ name, triangles }))
							.sort((a, b): number => b.triangles - a.triangles),
					}
				: null,
			error: state?.error ?? '',
		};
	}

	// ---- editing -----------------------------------------------------------------------

	/** Chooses the road type for selected segments, or for roads drawn next when nothing is selected. */
	pickProfile(id: string): void {
		const mesh: Mesh | null = this.manager.selected();
		const network: RoadNetwork | null = mesh ? this.manager.networkOf(mesh) : null;
		const segments: RoadSegment[] = mesh && network ? selectedSegments(mesh, network) : [];
		if (mesh && segments.length > 0) {
			this.manager.edit(mesh, 'Change road type', (net: RoadNetwork): void => {
				for (const s of segments) (net.segments.get(s.key) as RoadSegment).profile = id;
			});
		} else this.drawProfile = id;
	}

	/** Edits the shown road type. `copy` gives the selected segments their own copy first. */
	editProfile(edit: ProfileEdit, copy: boolean = false, label: string = 'Edit road type'): void {
		const mesh: Mesh | null = this.manager.selected();
		if (!mesh) {
			const draft: RoadNetwork = createNetwork(this.settingsForNew);
			for (const [id, p] of this.draftProfileMap) draft.profiles.set(id, p);
			const id: string = applyProfileEdit(draft, [], this.drawProfile, edit, copy);
			for (const [key, p] of draft.profiles) this.draftProfileMap.set(key, p);
			this.drawProfile = id;
			return;
		}
		this.manager.edit(mesh, label, (net: RoadNetwork): void => {
			const segments: RoadSegment[] = selectedSegments(mesh, net);
			const base: string = segments[0]?.profile ?? net.settings.defaultProfile;
			const targets: RoadSegment[] = segments.length > 0 ? segments : [...net.segments.values()].filter((s: RoadSegment): boolean => s.profile === base);
			const id: string = applyProfileEdit(net, targets, base, edit, copy);
			if (segments.length === 0) net.settings.defaultProfile = id;
		});
	}

	previewProfile(edit: ProfileEdit): void {
		const mesh: Mesh | null = this.manager.selected();
		if (!mesh) return;
		this.manager.preview(mesh, (net: RoadNetwork): void => {
			const segments: RoadSegment[] = selectedSegments(mesh, net);
			const base: string = segments[0]?.profile ?? net.settings.defaultProfile;
			const targets: RoadSegment[] = segments.length > 0 ? segments : [...net.segments.values()].filter((s: RoadSegment): boolean => s.profile === base);
			applyProfileEdit(net, targets, base, edit, false);
		});
	}

	setSettings(patch: SettingsPatch): void {
		const mesh: Mesh | null = this.manager.selected();
		if (!mesh) {
			this.settingsForNew = applySettingsPatch(this.settingsForNew as NetworkSettings, patch);
			return;
		}
		this.manager.edit(mesh, 'Change road settings', (net: RoadNetwork): void => {
			net.settings = applySettingsPatch(net.settings, patch);
		});
	}

	previewSettings(patch: SettingsPatch): void {
		const mesh: Mesh | null = this.manager.selected();
		if (mesh) this.manager.preview(mesh, (net: RoadNetwork): void => void (net.settings = applySettingsPatch(net.settings, patch)));
	}

	/** Changes flags on the selected segments (smooth, structure) or resets their curve handles. */
	setSegments(patch: Partial<SegmentData>, label: string = 'Change road segments'): void {
		const mesh: Mesh | null = this.manager.selected();
		if (!mesh) return;
		const segments: RoadSegment[] = selectedSegments(mesh, this.manager.networkOf(mesh));
		if (segments.length === 0) throw new Error('Select road points in vertex mode first.');
		this.manager.edit(mesh, label, (net: RoadNetwork): void => {
			for (const s of segments) Object.assign(net.segments.get(s.key) as RoadSegment, patch);
		});
	}

	setNodes(patch: Partial<NodeOptions>): void {
		const mesh: Mesh | null = this.manager.selected();
		if (!mesh) return;
		const ids: string[] = mesh.getSelectedVertices();
		if (ids.length === 0) throw new Error('Select road points in vertex mode first.');
		this.manager.edit(mesh, 'Change junction', (net: RoadNetwork): void => {
			for (const id of ids) {
				const node = net.nodes.get(id);
				if (node) node.options = { ...node.options, ...patch };
			}
		});
	}

	setStructure(structure: Structure): void {
		this.setSegments({ structure }, 'Change structure');
	}

	resetCurves(): void {
		this.setSegments({ handleA: null, handleB: null }, 'Reset road curves');
	}

	insertPoint(): void {
		const mesh: Mesh | null = this.manager.selected();
		if (!mesh) throw new Error('Select a road network first.');
		const segments: RoadSegment[] = selectedSegments(mesh, this.manager.networkOf(mesh));
		if (segments.length === 0) throw new Error('Select a road point, or both ends of a road, in vertex mode.');
		this.manager.edit(mesh, 'Insert road point', (net: RoadNetwork, ids: IdFactory): void => {
			for (const s of segments) insertPoint(net, s.key, ids());
		});
	}

	removePoint(): void {
		const mesh: Mesh | null = this.manager.selected();
		if (!mesh) throw new Error('Select a road network first.');
		const picked: string[] = mesh.getSelectedVertices();
		if (picked.length === 0) throw new Error('Select road points in vertex mode first.');
		this.manager.edit(mesh, 'Remove road point', (net: RoadNetwork): void => {
			for (const id of picked) if (net.nodes.has(id)) removePoint(net, id);
		});
	}

	// ---- drawing -----------------------------------------------------------------------

	startDrawing(): void {
		this.draw?.start();
	}
}
