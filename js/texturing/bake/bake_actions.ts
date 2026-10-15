import { bakeMap, BakeResult, computeUVCoverage, getBakeMeshes } from './bake';
import { BAKE_PASSES } from './bake_passes';
import { dilateRGBA } from './dilate';
import { DEFAULT_BAKE_OPTIONS } from './bake_types';
import type { BakeOptions, BakePassId } from './bake_types';

interface BakeFormResult {
	pass: BakePassId
	size: string
	samples: number
	max_distance: number
	padding: number
	smooth_normals: boolean
	strength: number
	selection_only: boolean
}

interface PaddingFormResult {
	pixels: number
}

interface GridFormResult {
	size: string
	cells: string
	labels: boolean
}

const SIZE_OPTIONS: Record<string, string> = {
	'64': '64', '128': '128', '256': '256', '512': '512', '1024': '1024', '2048': '2048', '4096': '4096',
};

function baseName(): string {
	const name: string = Texture.selected?.name ?? Project.name ?? 'model';
	return name.replace(/\.\w{2,4}$/, '') || 'model';
}

function usesRays(pass: BakePassId): boolean {
	return BAKE_PASSES[pass].needs_rays;
}

async function runBake(form: BakeFormResult): Promise<void> {
	const meshes: Mesh[] = getBakeMeshes(form.selection_only);
	if (!meshes.length) {
		Blockbench.showQuickMessage('message.bake.no_meshes', 2000);
		return;
	}
	const size: number = parseInt(form.size);
	const options: BakeOptions = {
		...DEFAULT_BAKE_OPTIONS,
		pass: form.pass,
		width: size,
		height: size,
		samples: form.samples,
		max_distance: form.max_distance,
		padding: form.padding,
		smooth_normals: form.smooth_normals,
		strength: form.strength,
		selection_only: form.selection_only,
	};
	Blockbench.setProgress(0.001);
	let result: BakeResult;
	try {
		result = await bakeMap(meshes, options, (fraction: number) => Blockbench.setProgress(fraction));
	} finally {
		Blockbench.setProgress(0);
	}
	if (!result.texel_count) {
		Blockbench.showQuickMessage('message.bake.empty_uv', 2500);
		return;
	}

	const canvas: HTMLCanvasElement = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	(canvas.getContext('2d') as CanvasRenderingContext2D).putImageData(result.image, 0, 0);

	// When the selected texture belongs to a material, the baked map takes over its channel
	const group: TextureGroup | null = Texture.selected?.getGroup() ?? null;
	const use_group: boolean = !!(group && group.is_material && result.pass.channel);
	const replaced: Texture[] = use_group && result.pass.channel
		? (group as TextureGroup).getTextures().filter((tex: Texture) => tex.pbr_channel == result.pass.channel)
		: [];
	Undo.initEdit({textures: replaced, texture_groups: use_group ? [group as TextureGroup] : []});
	replaced.forEach((tex: Texture) => { tex.group = ''; });
	const texture: Texture = new Texture({
		name: `${baseName()}_${result.pass.id}.png`,
		pbr_channel: result.pass.channel ?? 'color',
		group: use_group ? (group as TextureGroup).uuid : '',
	}).fromDataURL(canvas.toDataURL()).add(false);
	Undo.finishEdit('Bake texture map', {textures: [...replaced, texture], texture_groups: use_group ? [group as TextureGroup] : []});
	if (use_group) (group as TextureGroup).updateMaterial();
	Blockbench.showQuickMessage(tl('message.bake.done', [tl('dialog.bake.pass.' + result.pass.id), result.texel_count]), 2500);
}

BARS.defineActions(function() {
	const bake_dialog: Dialog = new Dialog({
		id: 'bake_texture_map',
		title: 'action.bake_texture_map',
		form: {
			pass: {
				label: 'dialog.bake.pass', type: 'select', value: 'ao',
				options: {
					ao: 'dialog.bake.pass.ao',
					thickness: 'dialog.bake.pass.thickness',
					curvature: 'dialog.bake.pass.curvature',
					normal: 'dialog.bake.pass.normal',
					position: 'dialog.bake.pass.position',
					id: 'dialog.bake.pass.id',
				},
			},
			size: {label: 'dialog.bake.size', type: 'select', value: '512', options: SIZE_OPTIONS},
			samples: {
				label: 'dialog.bake.samples', type: 'number', value: DEFAULT_BAKE_OPTIONS.samples, min: 1, max: 512, step: 1, force_step: true,
				condition: (form: BakeFormResult) => usesRays(form.pass),
			},
			max_distance: {
				label: 'dialog.bake.max_distance', description: 'dialog.bake.max_distance.desc', type: 'number', value: 0, min: 0, step: 0.5,
				condition: (form: BakeFormResult) => usesRays(form.pass),
			},
			strength: {
				label: 'dialog.bake.strength', type: 'number', value: 1, min: 0.05, max: 20, step: 0.05,
				condition: (form: BakeFormResult) => form.pass == 'curvature',
			},
			smooth_normals: {label: 'dialog.bake.smooth_normals', type: 'checkbox', value: false},
			padding: {label: 'dialog.bake.padding', type: 'number', value: DEFAULT_BAKE_OPTIONS.padding, min: 0, max: 64, step: 1, force_step: true},
			selection_only: {label: 'dialog.bake.selection_only', type: 'checkbox', value: false},
		},
		onConfirm(form: BakeFormResult) {
			runBake(form);
		},
	});
	new Action('bake_texture_map', {
		icon: 'local_fire_department',
		category: 'textures',
		condition: () => Mesh.all.length > 0,
		click() {
			bake_dialog.show();
		},
	});

	const padding_dialog: Dialog = new Dialog({
		id: 'texture_edge_padding',
		title: 'action.texture_edge_padding',
		form: {
			pixels: {label: 'dialog.bake.padding', type: 'number', value: 8, min: 1, max: 256, step: 1, force_step: true},
		},
		onConfirm(form: PaddingFormResult) {
			const texture: Texture | null = Texture.selected;
			if (!texture) return;
			const covered: Uint8Array = computeUVCoverage(getBakeMeshes(false), texture.width, texture.height);
			texture.edit((canvas: HTMLCanvasElement) => {
				const ctx: CanvasRenderingContext2D = canvas.getContext('2d') as CanvasRenderingContext2D;
				const image: ImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
				dilateRGBA(image.data, covered, canvas.width, canvas.height, form.pixels);
				ctx.putImageData(image, 0, 0);
			}, {edit_name: 'Extend texture edges'});
		},
	});
	new Action('texture_edge_padding', {
		icon: 'border_outer',
		category: 'textures',
		condition: () => !!Texture.selected && Mesh.all.length > 0,
		click() {
			padding_dialog.show();
		},
	});

	const grid_dialog: Dialog = new Dialog({
		id: 'generate_uv_grid',
		title: 'action.generate_uv_grid',
		form: {
			size: {label: 'dialog.bake.size', type: 'select', value: '512', options: SIZE_OPTIONS},
			cells: {label: 'dialog.uv_grid.cells', type: 'select', value: '8', options: {'4': '4 x 4', '8': '8 x 8', '16': '16 x 16', '32': '32 x 32'}},
			labels: {label: 'dialog.uv_grid.labels', type: 'checkbox', value: true},
		},
		onConfirm(form: GridFormResult) {
			const size: number = parseInt(form.size);
			const cells: number = parseInt(form.cells);
			const canvas: HTMLCanvasElement = document.createElement('canvas');
			canvas.width = size;
			canvas.height = size;
			const ctx: CanvasRenderingContext2D = canvas.getContext('2d') as CanvasRenderingContext2D;
			const cell_size: number = size / cells;
			// Hue shifts along u, lightness along v, so stretching and flipping are visible at a glance
			for (let y: number = 0; y < cells; y++) {
				for (let x: number = 0; x < cells; x++) {
					const checker: boolean = (x + y) % 2 == 0;
					const hue: number = (x / cells) * 300;
					ctx.fillStyle = `hsl(${hue}, 55%, ${(checker ? 38 : 30) + (y / cells) * 30}%)`;
					ctx.fillRect(x * cell_size, y * cell_size, Math.ceil(cell_size), Math.ceil(cell_size));
				}
			}
			ctx.strokeStyle = 'rgba(255,255,255,0.35)';
			ctx.lineWidth = Math.max(1, size / 512);
			for (let i: number = 0; i <= cells; i++) {
				ctx.beginPath(); ctx.moveTo(i * cell_size, 0); ctx.lineTo(i * cell_size, size); ctx.stroke();
				ctx.beginPath(); ctx.moveTo(0, i * cell_size); ctx.lineTo(size, i * cell_size); ctx.stroke();
			}
			if (form.labels && cell_size >= 20) {
				ctx.fillStyle = 'white';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.font = `bold ${Math.floor(cell_size * 0.38)}px sans-serif`;
				for (let y: number = 0; y < cells; y++) {
					for (let x: number = 0; x < cells; x++) {
						ctx.fillText(String.fromCharCode(65 + (x % 26)) + (y + 1), (x + 0.5) * cell_size, (y + 0.5) * cell_size);
					}
				}
			}
			new Texture({name: 'uv_grid.png'}).fromDataURL(canvas.toDataURL()).add(true);
		},
	});
	new Action('generate_uv_grid', {
		icon: 'grid_4x4',
		category: 'textures',
		click() {
			grid_dialog.show();
		},
	});
});

declare global {
	interface BarItemRegistry {
		bake_texture_map: Action
		texture_edge_padding: Action
		generate_uv_grid: Action
	}
}
