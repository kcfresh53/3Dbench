import { subdivideFaces, SubdivideResult } from './subdivide';
import { relaxVertices } from './smooth_vertices';
import { flattenVertices, FlattenAxis, FlattenTarget } from './flatten_vertices';
import { recalculateNormals, RecalcResult } from './recalc_normals';
import { modifyMeshSelection, SelectOperation } from './select_tools';
import { hasSubSelection, setMeshSelection, undoElementsWithBones } from './mesh_topology';

/** Vertices the tools act on: the selection, or every vertex when nothing is selected. */
function targetVertices(mesh: Mesh): string[] {
	const selected: Set<string> = new Set(mesh.getSelectedVertices());
	for (const fkey of mesh.getSelectedFaces()) mesh.faces[fkey]?.vertices.forEach((key: string) => selected.add(key));
	return selected.size ? Array.from(selected) : Object.keys(mesh.vertices);
}

/** Faces the tools act on: selected faces, else faces fully inside the vertex selection, else all faces. */
function targetFaces(mesh: Mesh): string[] {
	const selected_faces: string[] = mesh.getSelectedFaces();
	if (selected_faces.length) return selected_faces.slice();
	const vertices: string[] = mesh.getSelectedVertices();
	if (vertices.length >= 3) {
		const set: Set<string> = new Set(vertices);
		const inside: string[] = Object.keys(mesh.faces).filter((key: string) => mesh.faces[key].vertices.every((v: string) => set.has(v)));
		if (inside.length) return inside;
	}
	return Object.keys(mesh.faces);
}

function refresh(meshes: Mesh[], uv: boolean = true): void {
	Canvas.updateView({elements: meshes, element_aspects: {geometry: true, uv, faces: true}, selection: true});
	if (uv) UVEditor.loadData();
}

const mesh_condition = {modes: ['edit'], features: ['meshes'], method: (): boolean => Mesh.selected.length > 0};

interface SubdivideForm { cuts: number, smooth: number }
interface RelaxForm { iterations: number, factor: number, keep_volume: boolean, pin_borders: boolean }
interface FlattenForm { axis: FlattenAxis, target: FlattenTarget }
interface NormalsForm { inside: boolean, selection_only: boolean }

BARS.defineActions(function() {
	new Action('subdivide_mesh_selection', {
		icon: 'grid_view',
		category: 'edit',
		condition: mesh_condition,
		click() {
			const run = (amended: boolean, form: SubdivideForm): void => {
				const meshes: Mesh[] = Mesh.selected.slice();
				Undo.initEdit({elements: undoElementsWithBones(meshes), selection: true}, amended);
				for (const mesh of meshes) {
					const select_result: boolean = hasSubSelection(mesh);
					let targets: string[] = targetFaces(mesh);
					let last: SubdivideResult = {new_faces: [], vertices: []};
					for (let level: number = 0; level < form.cuts; level++) {
						last = subdivideFaces(mesh, targets, form.smooth);
						targets = last.new_faces;
					}
					if (select_result) setMeshSelection(mesh, last.vertices, last.new_faces);
				}
				Undo.finishEdit('Subdivide mesh');
				refresh(meshes);
			};
			run(false, {cuts: 1, smooth: 0});
			Undo.amendEdit({
				cuts: {type: 'number', value: 1, label: 'edit.subdivide_mesh_selection.cuts', min: 1, max: 4, step: 1},
				smooth: {type: 'num_slider', value: 0, label: 'edit.subdivide_mesh_selection.smooth', min: 0, max: 1, step: 0.05},
			}, (form: SubdivideForm) => run(true, form));
		}
	});

	new Action('smooth_vertices', {
		icon: 'blur_on',
		category: 'edit',
		condition: mesh_condition,
		click() {
			const run = (amended: boolean, form: RelaxForm): void => {
				const meshes: Mesh[] = Mesh.selected.slice();
				Undo.initEdit({elements: meshes, selection: true}, amended);
				for (const mesh of meshes) relaxVertices(mesh, targetVertices(mesh), form);
				Undo.finishEdit('Smooth vertices');
				refresh(meshes, false);
			};
			run(false, {iterations: 5, factor: 0.5, keep_volume: true, pin_borders: true});
			Undo.amendEdit({
				iterations: {type: 'number', value: 5, label: 'edit.smooth_vertices.iterations', min: 1, max: 100, step: 1},
				factor: {type: 'num_slider', value: 0.5, label: 'edit.smooth_vertices.factor', min: 0, max: 1, step: 0.05},
				keep_volume: {type: 'checkbox', value: true, label: 'edit.smooth_vertices.keep_volume'},
				pin_borders: {type: 'checkbox', value: true, label: 'edit.smooth_vertices.pin_borders'},
			}, (form: RelaxForm) => run(true, form));
		}
	});

	const flatten_dialog: Dialog = new Dialog({
		id: 'flatten_vertices',
		title: 'action.flatten_vertices',
		form: {
			axis: {label: 'dialog.flatten_vertices.axis', type: 'select', value: 'y', options: {x: 'X', y: 'Y', z: 'Z'}},
			target: {
				label: 'dialog.flatten_vertices.target', type: 'select', value: 'average',
				options: {
					average: 'dialog.flatten_vertices.target.average',
					min: 'dialog.flatten_vertices.target.min',
					max: 'dialog.flatten_vertices.target.max',
					first: 'dialog.flatten_vertices.target.first',
				},
			},
		},
		onConfirm(form: FlattenForm) {
			const meshes: Mesh[] = Mesh.selected.slice();
			Undo.initEdit({elements: meshes, selection: true});
			for (const mesh of meshes) flattenVertices(mesh, targetVertices(mesh), form.axis, form.target);
			Undo.finishEdit('Flatten vertices');
			refresh(meshes, false);
		},
	});
	new Action('flatten_vertices', {
		icon: 'vertical_align_center',
		category: 'edit',
		condition: mesh_condition,
		click() {
			flatten_dialog.show();
		}
	});

	const normals_dialog: Dialog = new Dialog({
		id: 'recalculate_normals',
		title: 'action.recalculate_normals',
		form: {
			inside: {label: 'dialog.recalculate_normals.inside', type: 'checkbox', value: false},
			selection_only: {label: 'dialog.uv_unwrap.selection_only', type: 'checkbox', value: false},
		},
		onConfirm(form: NormalsForm) {
			const meshes: Mesh[] = Mesh.selected.slice();
			Undo.initEdit({elements: meshes, selection: true});
			let flipped: number = 0;
			for (const mesh of meshes) {
				const faces: string[] = form.selection_only ? targetFaces(mesh) : Object.keys(mesh.faces);
				const result: RecalcResult = recalculateNormals(mesh, faces, form.inside);
				flipped += result.flipped;
			}
			Undo.finishEdit('Recalculate normals');
			refresh(meshes);
			Blockbench.showQuickMessage(tl('message.recalculate_normals.done', [flipped]), 2000);
		},
	});
	new Action('recalculate_normals', {
		icon: 'flip_to_front',
		category: 'edit',
		condition: mesh_condition,
		click() {
			normals_dialog.show();
		}
	});

	const selection_action = (id: string, icon: string, operation: SelectOperation, keybind?: Keybind): void => {
		new Action(id, {
			icon,
			category: 'select',
			keybind,
			condition: {modes: ['edit'], features: ['meshes'], method: (): boolean => Mesh.selected.length > 0 && Mesh.selected.some((m: Mesh) => hasSubSelection(m))},
			click() {
				Undo.initEdit({elements: Mesh.selected, selection: true});
				Mesh.selected.forEach((mesh: Mesh) => modifyMeshSelection(mesh, operation));
				Undo.finishEdit('Change mesh selection');
				updateSelection();
			}
		});
	};
	selection_action('select_linked_mesh', 'link', 'linked', new Keybind({key: 'l'}));
	selection_action('select_grow_mesh', 'add_box', 'grow');
	selection_action('select_shrink_mesh', 'indeterminate_check_box', 'shrink');
});

declare global {
	interface BarItemRegistry {
		subdivide_mesh_selection: Action
		smooth_vertices: Action
		flatten_vertices: Action
		recalculate_normals: Action
		select_linked_mesh: Action
		select_grow_mesh: Action
		select_shrink_mesh: Action
	}
}
