import { BrushDock, BRUSH_DOCK_CSS } from './editor/panel/brush_dock';
import { CityController } from './editor/controller';
import { INSTANCE_KEY, PROJECT_KEY } from './editor/ids';
import { buildCityPanel } from './editor/panel/city_panel';
import type { PanelInstance } from './editor/panel/city_panel';

interface Handle {
	delete(): void;
}

const VERSION: string = '1.0.0';
const ABOUT: string =
	'Build a game-ready city the way city builders do. Create a city, draw roads with Roadscape, sculpt the land with the Landscape tool, ' +
	'paint districts with the Zoning tool, and watch lots fill with buildings that grow taller as land value and development rise. ' +
	'Export a game package (meshes in three levels of detail on one atlas, terrain chunks, collision, manifest, Godot loader), ' +
	'bake everything to ordinary meshes, or make any selected mesh game ready (hidden faces removed, simplified, LODs). ' +
	'Reuses Roadscape (roads) and Procedural Trees (trees).';

let dock: BrushDock | null = null;
let controller: CityController | null = null;
let panel: Panel | null = null;
let style: Handle | null = null;
let property: Handle | null = null;
let actions: Action[] = [];

function dispose(): void {
	for (const action of actions) {
		Mesh.prototype.menu?.removeAction(action as never);
		action.delete();
	}
	actions = [];
	dock?.dispose();dock=null;
	panel?.delete();
	style?.delete();
	property?.delete();
	controller?.dispose();
	panel = null;
	style = null;
	property = null;
	controller = null;
	if ((globalThis as unknown as Record<symbol, unknown>)[INSTANCE_KEY] === dispose) delete (globalThis as unknown as Record<symbol, unknown>)[INSTANCE_KEY];
}

function defineAction(id: string, name: string, icon: string, click: () => void, meshMenu: boolean = false): void {
	const action: Action = new Action(id, {
		name,
		icon,
		category: 'tools',
		condition: (): boolean => !!Project && (id === 'citybuilder_game_ready' || !!controller?.store.state),
		click: (): void => click(),
	} as never) as Action;
	actions.push(action);
	MenuBar.addAction(action, 'tools');
	if (meshMenu) Mesh.prototype.menu?.addAction(action, 0);
}

export default function initializeCityBuilder(api: typeof BBPlugin): void {
	(globalThis as unknown as Record<symbol, (() => void) | undefined>)[INSTANCE_KEY]?.();
	api.register('citybuilder', {
		title: 'City Builder',
		author: '3D Bench',
		description: 'Landscape, zoning and growing buildings like Sim City or Cities: Skylines, with a one-click game-ready export. Works with Roadscape and Procedural Trees.',
		icon: 'location_city',
		version: VERSION,
		variant: 'both',
		min_version: '5.0.0',
		tags: ['Modeling', 'Generator', 'Game'],
		about: ABOUT,
		onload(): void {
			if (controller) dispose();
			(globalThis as unknown as Record<symbol, () => void>)[INSTANCE_KEY] = dispose;
			property = new Property(ModelProject, 'string', PROJECT_KEY, { default: '' }) as unknown as Handle;
			const ctl: CityController = new CityController();
			controller = ctl;
			dock=new BrushDock(ctl);
			const parts = buildCityPanel(ctl, (instance: PanelInstance): void => {
				const update = (): void => {
					instance.snap = ctl.snapshot();
					instance.status = ctl.status;
				};
				ctl.changed.on(update);
				update();
			});
			style = Blockbench.addCSS(parts.css + BRUSH_DOCK_CSS) as Handle;
			panel = new Panel('citybuilder_panel', {
				name: 'City Builder',
				icon: 'location_city',
				condition: (): boolean => !!Project && Modes.edit,
				default_side: 'right',
				insert_before: 'transform',
				growable: true,
				resizable: true,
				default_position: { slot: 'right_bar', height: 640 },
				component: parts.component,
			} as never) as Panel;
			defineAction('citybuilder_export', 'City Builder — Export Game Package', 'upload_file', (): void => void ctl.exportPackage());
			defineAction('citybuilder_bake', 'City Builder — Bake City to Meshes', 'view_in_ar', (): void => void ctl.bake());
			defineAction('citybuilder_drape', 'City Builder — Drape Roads on Terrain', 'terrain', (): void => ctl.drape());
			defineAction('citybuilder_game_ready', 'Make Game Ready (remove hidden faces, LODs)', 'speed', (): void => void ctl.gameReadySelection(), true);
		},
		onunload: dispose,
	} as never);
}
