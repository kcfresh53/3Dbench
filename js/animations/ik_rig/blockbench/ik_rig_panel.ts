import Vue from 'vue/dist/vue.js';
import { editMotionRule } from './ik_rig_rule_editor';
import type { RuleConfig, SolverConfig } from '../core/rig_types';
import { Blockbench } from '../../../api';
import { IKRigController } from './ik_rig_controller';
import { getRigData } from './ik_rig_project';
import { createRigFromScene, redetectBones, selectHandle, SetupResult } from './ik_rig_setup';
import type { IKRigProjectData } from './ik_rig_data';

/** Editable numeric fields per solver / rule kind */
interface ParamField {
	key: string;
	label: string;
	min: number;
	max: number;
	step: number;
}

const PARAMS: Record<string, ParamField[]> = {
	body: [
		{ key: 'crouch', label: 'Crouch', min: 0, max: 0.65, step: 0.01 },
		{ key: 'vertical_weight', label: 'Vertical follow', min: 0, max: 1, step: 0.05 },
		{ key: 'horizontal_weight', label: 'Horizontal follow', min: 0, max: 1, step: 0.05 },
		{ key: 'tilt_weight', label: 'Pelvis tilt', min: 0, max: 1, step: 0.05 },
		{ key: 'max_tilt_deg', label: 'Max tilt (deg)', min: 0, max: 45, step: 1 },
		{ key: 'max_extension', label: 'Max leg extension', min: 0.8, max: 1, step: 0.01 },
		{ key: 'hand_pull', label: 'Hand pull', min: 0, max: 1, step: 0.05 },
	],
	spine: [
		{ key: 'lean_forward_deg', label: 'Forward lean (deg)', min: -60, max: 60, step: 1 },
		{ key: 'lean_side_deg', label: 'Side lean (deg)', min: -60, max: 60, step: 1 },
	],
	limb: [
		{ key: 'softness', label: 'Soft reach', min: 0, max: 1, step: 0.05 },
		{ key: 'max_interior_deg', label: 'Max bend angle', min: 90, max: 180, step: 1 },
		{ key: 'min_interior_deg', label: 'Min bend angle', min: 0, max: 90, step: 1 },
	],
	aim: [{ key: 'max_angle_deg', label: 'Max angle (deg)', min: 5, max: 180, step: 1 }],
	ground: [
		{ key: 'lift_threshold', label: 'Plant height', min: 0.01, max: 0.3, step: 0.01 },
		{ key: 'swing_follow', label: 'Swing follows ground', min: 0, max: 1, step: 0.05 },
		{ key: 'slope_weight', label: 'Align to slope', min: 0, max: 1, step: 0.05 },
	],
	foot_lock: [
		{ key: 'speed_threshold', label: 'Plant speed', min: 0.05, max: 1.5, step: 0.05 },
		{ key: 'lift_threshold', label: 'Plant height', min: 0.01, max: 0.3, step: 0.01 },
		{ key: 'blend_time', label: 'Blend time (s)', min: 0, max: 0.5, step: 0.01 },
	],
};

/** The parts of the panel's Vue instance that its methods use */
interface RigPanelVm {
	rig: IKRigProjectData | null;
	message: string;
	refresh(): void;
	show(result: SetupResult): void;
}

Interface.definePanels(function() {
	new Panel('ik_rig', {
		icon: 'accessibility_new',
		condition: { modes: ['animate'] },
		growable: true,
		resizable: true,
		default_position: {
			slot: 'left_bar',
			float_position: [0, 0],
			float_size: [320, 520],
			height: 520,
			sidebar_index: 11,
		},
		component: {
			name: 'panel-ik-rig',
			data() {
				return { rig: null as IKRigProjectData | null, params: PARAMS, message: '' };
			},
			methods: {
				beginEdit(event: Event): void {
					if ((event.target as HTMLElement).matches('input, select') && !Undo.current_save) Undo.initEdit({ ik_rig: true });
				},
				finishEdit(): void {
					if (Undo.current_save?.aspects.ik_rig) Undo.finishEdit('Edit IK rig');
				},
				editRule(rule?: RuleConfig): void { editMotionRule(rule); },
				moveRule(this: RigPanelVm, rule: RuleConfig, direction: number): void {
					if (!this.rig) return;
					const rules = this.rig.config.rules;
					const index = rules.indexOf(rule), next = index + direction;
					if (index < 0 || next < 0 || next >= rules.length) return;
					Undo.initEdit({ ik_rig: true });
					rules.splice(index, 1);
					rules.splice(next, 0, rule);
					Undo.finishEdit('Reorder IK rules');
					IKRigController.forProject()?.configChanged();
				},
				removeRule(this: RigPanelVm, rule: RuleConfig): void {
					if (!this.rig) return;
					const index = this.rig.config.rules.indexOf(rule);
					if (index < 0) return;
					Undo.initEdit({ ik_rig: true });
					this.rig.config.rules.splice(index, 1);
					Undo.finishEdit('Remove IK rule');
					IKRigController.forProject()?.configChanged();
				},
				refresh(this: RigPanelVm): void {
					// assigning makes the stored object reactive in place, so edits go straight into the project
					this.rig = getRigData();
				},
				setSolverParam(solver: SolverConfig, key: string, event: Event): void {
					Vue.set(solver, key, Number((event.target as HTMLInputElement).value));
					IKRigController.forProject()?.configChanged();
				},
				changed(): void {
					IKRigController.forProject()?.configChanged();
				},
				create(this: RigPanelVm): void {
					this.show(createRigFromScene());
					this.refresh();
				},
				redetect(this: RigPanelVm): void {
					this.show(redetectBones());
				},
				show(this: RigPanelVm, result: SetupResult): void {
					this.message = result.message;
					this.refresh();
					IKRigController.forProject()?.invalidate();
					if (Modes.animate) Animator.preview();
				},
				handle(goal_id: string): void {
					selectHandle(goal_id);
				},
				invalidated(): void {
					IKRigController.forProject()?.invalidate();
					if (Modes.animate) Animator.preview();
				},
				useSelectionAsGround(): void {
					BarItems.ik_rig_ground_from_selection.trigger();
				},
				useFlatGround(): void {
					BarItems.ik_rig_ground_flat.trigger();
				},
				bake(): void {
					BarItems.bake_ik_rig.trigger();
				},
				importAnimations(): void {
					BarItems.import_retarget_animations.trigger();
				},
				remove(): void {
					BarItems.delete_ik_rig.trigger();
				},
				fieldsOf(kind: string): ParamField[] {
					return PARAMS[kind] ?? [];
				},
				goalHasPole(kind: string): boolean {
					return kind == 'foot' || kind == 'hand';
				},
				goalHasPosition(kind: string): boolean {
					return kind != 'chest';
				},
				title(id: string): string {
					return id.replace(/_/g, ' ').replace(/^./, (c: string): string => c.toUpperCase());
				},
				boundCount(this: RigPanelVm): number {
					return this.rig ? Object.keys(this.rig.bindings).length : 0;
				},
			},
			mounted(this: RigPanelVm): void {
				this.refresh();
				const refresh = (): void => this.refresh();
				for (const event of ['select_project', 'load_project', 'undo', 'redo', 'finish_edit', 'update_ik_rig'] as const) {
					Blockbench.on(event as never, refresh);
				}
			},
			template: `
			<div @pointerdown="beginEdit($event)" @focusin="beginEdit($event)" @keydown="beginEdit($event)" @change="finishEdit()" @focusout="finishEdit()" style="padding: 8px 10px; overflow-y: auto; height: 100%; box-sizing: border-box;">
				<div v-if="!rig">
					<p style="color: var(--color-subtle_text); margin: 0 0 10px;">
						An IK rig turns the animation into goals for hands, feet and head, adapts them with rules
						(ground, foot locking, attachments) and solves the body to reach them.
						Select an armature and create a rig to start.
					</p>
					<button type="button" @click="create()">Create IK Rig</button>
					<p v-if="message" style="margin-top: 8px;">{{ message }}</p>
				</div>
				<div v-else>
					<label style="display: flex; gap: 8px; align-items: center;">
						<input type="checkbox" v-model="rig.enabled" @change="invalidated()">
						<b>{{ rig.config.name }}</b>
					</label>
					<p style="margin: 4px 0 8px; color: var(--color-subtle_text);">{{ boundCount() }} bones bound</p>
					<div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px;">
						<button type="button" @click="bake()">Bake</button>
						<button type="button" @click="importAnimations()">Import Animations</button>
						<button type="button" @click="redetect()">Re-detect Bones</button>
						<button type="button" @click="remove()">Delete Rig</button>
					</div>
					<p v-if="message" style="margin: 0 0 8px;">{{ message }}</p>

					<h4 style="margin: 12px 0 4px;">Goals</h4>
					<div v-for="goal in rig.config.goals" :key="goal.id" style="margin-bottom: 8px; padding: 4px 6px; background: var(--color-back);">
						<div style="display: flex; align-items: center; gap: 6px;">
							<b style="flex: 1;">{{ goal.label }}</b>
							<select v-model="goal.mode" @change="changed()" v-if="goal.kind != 'chest'">
								<option value="follow">Follow animation</option>
								<option value="handle">Handle only</option>
							</select>
							<button type="button" v-if="goal.kind != 'chest'" @click="handle(goal.id)">Handle</button>
						</div>
						<label v-if="goalHasPosition(goal.kind)" style="display: flex; gap: 6px; align-items: center;">
							<span style="width: 70px;">Position</span>
							<input type="range" min="0" max="1" step="0.05" v-model.number="goal.position_weight" @input="changed()" style="flex: 1;">
						</label>
						<label style="display: flex; gap: 6px; align-items: center;">
							<span style="width: 70px;">Rotation</span>
							<input type="range" min="0" max="1" step="0.05" v-model.number="goal.rotation_weight" @input="changed()" style="flex: 1;">
						</label>
						<label v-if="goalHasPole(goal.kind)" style="display: flex; gap: 6px; align-items: center;">
							<span style="width: 70px;">Pole</span>
							<input type="range" min="0" max="1" step="0.05" v-model.number="goal.pole_weight" @input="changed()" style="flex: 1;">
						</label>
					</div>

					<h4 style="margin: 12px 0 4px;">Rules</h4>
					<p style="color: var(--color-subtle_text);">Rules run from top to bottom. Place offsets before ground and foot locking to preserve contacts.</p>
					<button type="button" @click="editRule()">Add Motion Rule</button>
					<div v-for="rule in rig.config.rules" :key="rule.id" style="margin-bottom: 8px; padding: 4px 6px; background: var(--color-back);">
						<div style="display: flex; gap: 4px; margin-bottom: 4px;">
							<button type="button" @click="moveRule(rule, -1)" :disabled="rig.config.rules[0] === rule" title="Move earlier">↑</button>
							<button type="button" @click="moveRule(rule, 1)" :disabled="rig.config.rules[rig.config.rules.length - 1] === rule" title="Move later">↓</button>
							<button type="button" v-if="['offset', 'oscillate', 'attach'].includes(rule.kind)" @click="editRule(rule)">Edit</button>
							<button type="button" v-if="['offset', 'oscillate', 'attach'].includes(rule.kind)" @click="removeRule(rule)">Remove</button>
						</div>
						<label style="display: flex; gap: 6px; align-items: center;">
							<input type="checkbox" v-model="rule.enabled" @change="changed()">
							<b style="flex: 1;">{{ title(rule.kind) }}<span v-if="rule.kind == 'attach' || rule.kind == 'offset' || rule.kind == 'oscillate'"> ({{ rule.goal }})</span></b>
						</label>
						<label style="display: flex; gap: 6px; align-items: center;">
							<span style="width: 110px;">Weight</span>
							<input type="range" min="0" max="1" step="0.05" v-model.number="rule.weight" @input="changed()" style="flex: 1;">
						</label>
						<label v-for="field in fieldsOf(rule.kind)" :key="field.key" style="display: flex; gap: 6px; align-items: center;">
							<span style="width: 110px;">{{ field.label }}</span>
							<input type="range" :min="field.min" :max="field.max" :step="field.step" v-model.number="rule[field.key]" @input="changed()" style="flex: 1;">
						</label>
					</div>

					<h4 style="margin: 12px 0 4px;">Solvers</h4>
					<div v-for="solver in rig.config.solvers" :key="solver.id" style="margin-bottom: 8px; padding: 4px 6px; background: var(--color-back);">
						<label style="display: flex; gap: 6px; align-items: center;">
							<input type="checkbox" v-model="solver.enabled" @change="changed()">
							<b style="flex: 1;">{{ title(solver.id) }} <span style="color: var(--color-subtle_text);">({{ solver.kind }})</span></b>
						</label>
						<label style="display: flex; gap: 6px; align-items: center;">
							<span style="width: 110px;">Weight</span>
							<input type="range" min="0" max="1" step="0.05" v-model.number="solver.weight" @input="changed()" style="flex: 1;">
						</label>
						<label v-for="field in fieldsOf(solver.kind)" :key="field.key" style="display: flex; gap: 6px; align-items: center;">
							<span style="width: 110px;">{{ field.label }}</span>
							<input type="range" :min="field.min" :max="field.max" :step="field.step" :value="solver[field.key] == null ? 0 : solver[field.key]" @input="setSolverParam(solver, field.key, $event)" style="flex: 1;">
						</label>
					</div>

					<h4 style="margin: 12px 0 4px;">Ground</h4>
					<div style="padding: 4px 6px; background: var(--color-back);">
						<p style="margin: 0 0 6px; color: var(--color-subtle_text);">
							{{ rig.ground.mode == 'objects' ? rig.ground.objects.length + ' elements used as ground' : 'Flat floor' }}
						</p>
						<label style="display: flex; gap: 6px; align-items: center;">
							<span style="width: 110px;">Floor height</span>
							<input type="number" v-model.number="rig.ground.height" @input="invalidated()" style="width: 80px;">
						</label>
						<div style="display: flex; gap: 6px; margin-top: 6px;">
							<button type="button" @click="useSelectionAsGround()">Use selection as ground</button>
							<button type="button" @click="useFlatGround()">Flat floor</button>
						</div>
					</div>

					<h4 style="margin: 12px 0 4px;">Handles</h4>
					<label style="display: flex; gap: 6px; align-items: center;">
						<span style="width: 110px;">Fade time (s)</span>
						<input type="range" min="0" max="1" step="0.05" v-model.number="rig.handle_blend" @input="changed()" style="flex: 1;">
					</label>
				</div>
			</div>`,
		},
	});
});
