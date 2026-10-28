import { packedLibrary } from '../assets/packed_library';
import { BAKED_KEY, INSTANCE_KEY, LEGACY_LIVE_KEY, NETWORK_KEY } from './editor/ids';
import { LiveRoads } from './editor/live_manager';
import type { LiveState } from './editor/live_manager';
import { loadLibrary } from './editor/library_loader';
import { DrawTool } from './editor/draw_tool';
import { RoadSession } from './editor/session';
import type { Snapshot } from './editor/session';
import { buildPanelComponent } from './editor/panel/road_panel';
import type { PanelInstance } from './editor/panel/road_panel';
import { isSpline, splineAnchors } from './editor/spline_import';
import { selectMoveTool, setSelectionMode } from './editor/bb_access';

interface Handle {
	delete(): void;
}

const VERSION: string = '3.0.0';
const ABOUT: string =
	'Build roads the way a city builder does. Tools → Draw Road: click points in the viewport; click an existing road to branch from it, and crossings become junctions automatically. ' +
	'Pick a road type in the sidebar and stack any number of strips (curb, sidewalk, grass verge, bike lane …) and linings (lamps, procedural trees, guardrails, hedges, walls …) on each side. ' +
	'Bridges and tunnels are chosen from height. Drag road points with the normal Move tool; the road follows. Bake Roadscape to Meshes before export. ' +
	'Source artwork: Roadscape 4.13.10 by Baptiste Mollicone and SLX. GPL-3.0-or-later.';

let manager: LiveRoads | null = null;
let session: RoadSession | null = null;
let drawTool: DrawTool | null = null;
let panel: Panel | null = null;
let panelInstance: PanelInstance | null = null;
let actions: Action[] = [];
let properties: Handle[] = [];
let styleSheet: Handle | null = null;

function report(error: unknown): void {
	const message: string = (error as Error).message ?? String(error);
	console.error('Roadscape', error);
	Blockbench.showQuickMessage(message, 5000);
	if (panelInstance) panelInstance.status = message;
}

function dispose(): void {
	drawTool?.dispose();
	manager?.dispose();
	for (const action of actions) {
		Mesh.prototype.menu?.removeAction(action as never);
		action.delete();
	}
	actions = [];
	panel?.delete();
	styleSheet?.delete();
	for (const p of properties) p.delete();
	properties = [];
	panel = null;
	panelInstance = null;
	styleSheet = null;
	manager = null;
	session = null;
	drawTool = null;
	if ((globalThis as unknown as Record<symbol, unknown>)[INSTANCE_KEY] === dispose) delete (globalThis as unknown as Record<symbol, unknown>)[INSTANCE_KEY];
}

function refreshPanel(mesh: Mesh | null, state: LiveState | undefined): void {
	if (!panelInstance || !session) return;
	try {
		const snap: Snapshot = session.snapshot(mesh, state);
		panelInstance.snap = snap;
	} catch (error) {
		console.error('Roadscape panel', error);
	}
}

function defineAction(id: string, name: string, click: () => void, needsRoad: boolean): Action {
	const condition = (): boolean => !!Project && !!Format.meshes && Modes.edit && (!needsRoad || !!manager?.selected());
	const action: Action = new Action(id, { name, icon: 'add_road', category: 'tools', condition, click: (): void => guarded(click) } as never) as Action;
	actions.push(action);
	MenuBar.addAction(action, 'tools');
	if (needsRoad) Mesh.prototype.menu?.addAction(action, 0);
	return action;
}

function guarded(run: () => void): void {
	try {
		run();
	} catch (error) {
		report(error);
	}
}

function fromSpline(): void {
	if (!manager || !session) return;
	const spline: unknown = Outliner.selected[0];
	if (!isSpline(spline)) throw new Error('Select one native spline.');
	const { anchors, closed } = splineAnchors(spline);
	manager.commitDraft(manager.target(), anchors, session.segmentData(), closed, 0.05, session.newSettings(), session.draftProfiles());
}

export default function initializeRoadscape(api: typeof BBPlugin): void {
	(globalThis as unknown as Record<symbol, (() => void) | undefined>)[INSTANCE_KEY]?.();
	api.register('roadscape', {
		title: 'Roadscape',
		author: 'Baptiste Mollicone / SLX; city-builder style rework by 3D Bench',
		description: 'Draw road networks like a city builder: automatic junctions, stackable roadside strips and linings, procedural trees, bridges and tunnels.',
		icon: 'add_road',
		version: VERSION,
		variant: 'both',
		min_version: '5.0.0',
		tags: ['Modeling', 'Generator'],
		about: ABOUT,
		onload(): void {
			if (manager) dispose();
			(globalThis as unknown as Record<symbol, () => void>)[INSTANCE_KEY] = dispose;
			properties = [
				new Property(Mesh, 'string', NETWORK_KEY, { default: '' }) as Handle,
				new Property(Mesh, 'string', LEGACY_LIVE_KEY, { default: '' }) as Handle,
				new Property(Group, 'string', BAKED_KEY, { default: '' }) as Handle,
			];
			manager = new LiveRoads((): Promise<never> => loadLibrary(packedLibrary) as Promise<never>, refreshPanel);
			manager.ready.catch(report);
			session = new RoadSession(manager);
			drawTool = new DrawTool(session);
			session.draw = drawTool;
			session.message = (text: string): void => {
				if (panelInstance) panelInstance.status = text;
			};
			const initial: Snapshot = session.snapshot(null, undefined);
			const parts = buildPanelComponent(session, initial, (instance: PanelInstance): void => {
				panelInstance = instance;
				refreshPanel(manager?.selected() ?? null, manager?.selected() ? manager.states.get(manager.selected() as Mesh) : undefined);
			});
			styleSheet = Blockbench.addCSS(parts.css) as Handle;
			panel = new Panel('roadscape_panel', {
				name: 'Roadscape',
				icon: 'add_road',
				condition: (): boolean => !!Project && !!Format.meshes && Modes.edit,
				default_side: 'right',
				insert_before: 'transform',
				growable: true,
				resizable: true,
				default_position: { slot: 'right_bar', height: 620 },
				component: parts.component,
			} as never) as Panel;
			defineAction('roadscape', 'Roadscape — Draw Road', (): void => session?.startDrawing(), false);
			defineAction(
				'roadscape_edit',
				'Edit Roadscape Network',
				(): void => {
					panel?.fold(false);
					setSelectionMode('vertex');
					selectMoveTool();
					updateSelection();
				},
				true,
			);
			defineAction('roadscape_auto_setup', 'Auto-setup Road Junctions', (): void => void manager?.autoSetup(manager.selected() as Mesh), true);
			defineAction('roadscape_bake', 'Bake Roadscape to Meshes', (): void => void manager?.bake(manager.selected() as Mesh).catch(report), true);
			defineAction('roadscape_insert_point', 'Insert Road Point', (): void => session?.insertPoint(), true);
			defineAction('roadscape_remove_point', 'Remove Road Point', (): void => session?.removePoint(), true);
			defineAction('roadscape_from_spline', 'Use Selected Spline as Road', fromSpline, false);
		},
		onunload: dispose,
	} as never);
}
