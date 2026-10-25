import { generateTreeSet } from './core/tree_generator';
import type { PresetName, TreeLod, TreeParams } from './core/types';
import { paintAtlas } from './texture/atlas';
import { TREE_KEY, createTreeInProject, readStoredTree, selectedTreeGroup } from './blockbench/bridge';
import { defaultRequest, openTreeDialog } from './ui/tree_dialog';
import { TREE_DIALOG_CSS } from './ui/styles';

let createAction: Action | undefined;
let editAction: Action | undefined;
let metadataProperty: Property | undefined;
let styleSheet: { delete(): void } | undefined;

async function generate(params: TreeParams, preset: PresetName, existing: Group | null): Promise<void> {
	const owner: typeof Project = Project;
	try {
		const lods: TreeLod[] = generateTreeSet(params);
		const atlas: string = await paintAtlas(params);
		if (Project !== owner || (existing && !Group.all.includes(existing))) {
			Blockbench.showQuickMessage('The original project or tree is no longer open.');
			return;
		}
		createTreeInProject(lods, atlas, params, preset, existing);
		const summary: string = lods.map((l: TreeLod, i: number): string => `LOD${i}: ${l.triangles} tris`).join(', ');
		const over: boolean = lods.some((l: TreeLod): boolean => !l.withinBudget);
		Blockbench.showQuickMessage(over ? `${summary} (budget could not be met)` : summary, 3000);
	} catch (error) {
		console.error(error);
		Blockbench.showQuickMessage(`Tree generation failed: ${(error as Error).message}`, 5000);
	}
}

export default function initializeTrees(pluginApi: typeof BBPlugin): void {
pluginApi.register('procedural_trees', {
	title: 'Procedural Trees',
	author: '3DBench',
	description:
		'Game-ready trees and foliage: stylized and realistic presets, triangle budget, LODs, one atlas, texture slots and a live preview.',
	about:
		'Tools → Procedural Tree. Twelve presets (oak, pine, birch, bush, palm, dead tree in stylized and realistic variants). Pick bark and leaf images in the Texture slots section, or use the procedural paint. Select a generated tree and use Tools → Edit Procedural Tree to regenerate it.',
	icon: 'park',
	version: '2.3.0',
	variant: 'both',
	min_version: '5.0.0',
	tags: ['Modeling', 'Generator'],
	onload(): void {
		metadataProperty = new Property(Group, 'string', TREE_KEY, { default: '' });
		styleSheet = Blockbench.addCSS(TREE_DIALOG_CSS) as { delete(): void };
		const condition = (): boolean => !!Project && !!Format.meshes && Modes.edit;
		createAction = new Action('procedural_tree', {
			name: 'Procedural Tree…',
			description: 'Generate a game-ready tree with foliage',
			icon: 'park',
			category: 'tools',
			condition,
			click: (): void => openTreeDialog(defaultRequest(), (p: TreeParams, preset: PresetName): void => void generate(p, preset, null)),
		} as never);
		editAction = new Action('edit_procedural_tree', {
			name: 'Edit Procedural Tree…',
			icon: 'edit',
			category: 'tools',
			condition: (): boolean => condition() && !!selectedTreeGroup(),
			click: (): void => {
				const group: Group | null = selectedTreeGroup();
				const stored = group ? readStoredTree(group) : null;
				if (!group || !stored) return;
				openTreeDialog({ preset: stored.preset, params: stored.params, editing: true }, (p: TreeParams, preset: PresetName): void =>
					void generate(p, preset, group),
				);
			},
		} as never);
		MenuBar.addAction(createAction, 'tools');
		MenuBar.addAction(editAction, 'tools');
	},
	onunload(): void {
		createAction?.delete();
		editAction?.delete();
		metadataProperty?.delete();
		styleSheet?.delete();
	},
} as never);

}
