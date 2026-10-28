import type { LiningElement, LiningType, SideElement, StripElement, StripType, SurfaceId, TreeSpec } from '../../core/model';
import { LINING_ORDER, LINING_TYPES } from '../../core/lining_library';
import type { LiningDefinition, LiningField } from '../../core/lining_library';
import { STRIP_ORDER, STRIP_TYPES } from '../../core/strip_library';
import { PRESET_NAMES, presetLabel } from '../../../../procedural_trees/src/ui/presets';
import type { ComponentDefinition } from './component_types';
import { NumberField, SelectField, ToggleField } from './fields';

export interface Option {
	value: string;
	label: string;
}

const SURFACES: SurfaceId[] = ['asphalt', 'trail', 'sidewalk', 'curb', 'gutter', 'terrain', 'deck', 'concrete', 'racing_red', 'racing_white'];
const PLACEMENTS: Option[] = [
	{ value: 'start', label: 'Inner edge of strip' },
	{ value: 'center', label: 'Middle of strip' },
	{ value: 'end', label: 'Outer edge of strip' },
];

export const SURFACE_OPTIONS: Option[] = SURFACES.map((s: SurfaceId): Option => ({ value: s, label: s.replace('_', ' ') }));
export const STRIP_OPTIONS: Option[] = STRIP_ORDER.map((t: StripType): Option => ({ value: t, label: STRIP_TYPES[t].label }));
export const LINING_OPTIONS: Option[] = LINING_ORDER.map((t: LiningType): Option => ({ value: t, label: LINING_TYPES[t].label }));
const TREE_PRESETS: Option[] = PRESET_NAMES.map((p: string): Option => ({ value: p, label: presetLabel(p as never) }));

function stripDefinition(this: { element: StripElement }): unknown {
	return STRIP_TYPES[this.element.type];
}

function liningDefinition(this: { element: LiningElement }): LiningDefinition {
	return LINING_TYPES[this.element.type];
}

function patchLiningField(this: { $emit(event: string, payload: unknown): void }, field: LiningField, value: number): void {
	this.$emit('patch', { [field.key]: value });
}

/** Editable tree description shared by tree linings. */
const TreeEditor: ComponentDefinition = {
	name: 'rs-tree-editor',
	components: { 'rs-number': NumberField, 'rs-select': SelectField },
	props: ['tree'],
	data: (): Record<string, unknown> => ({ presets: TREE_PRESETS }),
	template: `<div class="rs_nested">
		<rs-select label="Tree" :value="tree.preset" :options="presets" @input="v => $emit('patch', {preset: v})"></rs-select>
		<rs-number label="Height" suffix="m" :value="tree.height" :min="1" :max="40" :step="0.5" @input="v => $emit('patch', {height: v})"></rs-number>
		<rs-number label="Variations" :value="tree.variants" :min="1" :max="8" :step="1" @input="v => $emit('patch', {variants: v})"></rs-number>
		<rs-number label="Triangles per tree" :value="tree.maxTriangles" :min="12" :max="2000" :step="10" @input="v => $emit('patch', {maxTriangles: v})"></rs-number>
		<rs-number label="Seed" :value="tree.seed" :min="0" :max="9999" :step="1" @input="v => $emit('patch', {seed: v})"></rs-number>
	</div>`,
};

/** One strip (sidewalk, curb, verge ...) in a side stack. */
const StripRow: ComponentDefinition = {
	name: 'rs-strip-row',
	components: { 'rs-number': NumberField, 'rs-select': SelectField },
	props: ['element', 'first', 'last'],
	data: (): Record<string, unknown> => ({ surfaces: SURFACE_OPTIONS }),
	computed: { def: stripDefinition as never },
	template: `<div class="rs_element rs_strip">
		<div class="rs_element_head">
			<strong>{{def.label}}</strong>
			<span class="rs_buttons">
				<button :disabled="first" title="Move inward" @click="$emit('move', -1)">↑</button>
				<button :disabled="last" title="Move outward" @click="$emit('move', 1)">↓</button>
				<button title="Remove" @click="$emit('remove')">✕</button>
			</span>
		</div>
		<rs-number label="Width" suffix="m" :value="element.width" :min="def.minWidth" :max="def.maxWidth" :step="0.05" @input="v => $emit('patch', {width: v})"></rs-number>
		<rs-number label="Height" suffix="m" :value="element.top" :min="-0.5" :max="1.5" :step="0.01" @input="v => $emit('patch', {top: v})"></rs-number>
		<rs-select label="Surface" :value="element.surface" :options="surfaces" @input="v => $emit('patch', {surface: v})"></rs-select>
	</div>`,
};

/** One lining (lamps, trees, guardrail ...) in a side stack. */
const LiningRow: ComponentDefinition = {
	name: 'rs-lining-row',
	components: { 'rs-number': NumberField, 'rs-select': SelectField, 'rs-toggle': ToggleField, 'rs-tree-editor': TreeEditor },
	props: ['element', 'first', 'last'],
	data: (): Record<string, unknown> => ({ placements: PLACEMENTS }),
	computed: { def: liningDefinition as never },
	template: `<div class="rs_element rs_lining" :class="{rs_off: !element.enabled}">
		<div class="rs_element_head">
			<label class="rs_check"><input type="checkbox" :checked="element.enabled" @change="$emit('patch', {enabled: $event.target.checked})"><strong>{{def.label}}</strong></label>
			<span class="rs_buttons">
				<button :disabled="first" title="Move inward" @click="$emit('move', -1)">↑</button>
				<button :disabled="last" title="Move outward" @click="$emit('move', 1)">↓</button>
				<button title="Remove" @click="$emit('remove')">✕</button>
			</span>
		</div>
		<template v-if="element.enabled">
			<rs-select v-if="def.hasPlacement" label="Sits on" :value="element.placement" :options="placements" @input="v => $emit('patch', {placement: v})"></rs-select>
			<rs-number v-for="f in def.fields" :key="f.key" :label="f.label" :value="element[f.key]" :min="f.min" :max="f.max" :step="f.step" @input="v => patchField(f, v)"></rs-number>
			<rs-toggle v-if="def.hasJunctionToggle" label="Also at junction corners" :value="element.atJunctions" @input="v => $emit('patch', {atJunctions: v})"></rs-toggle>
			<rs-toggle v-if="def.hasStagger" label="Stagger across the road" :value="element.stagger" @input="v => $emit('patch', {stagger: v})"></rs-toggle>
			<rs-tree-editor v-if="element.type === 'tree'" :tree="element.tree" @patch="p => $emit('patch', {tree: Object.assign({}, element.tree, p)})"></rs-tree-editor>
		</template>
	</div>`,
	methods: { patchField: patchLiningField as never },
};

/** Everything beside the road on one side, from the carriageway edge outward. */
export const SideStack: ComponentDefinition = {
	name: 'rs-side-stack',
	components: { 'rs-strip-row': StripRow, 'rs-lining-row': LiningRow, 'rs-select': SelectField },
	props: ['title', 'elements'],
	data: (): Record<string, unknown> => ({ stripOptions: STRIP_OPTIONS, liningOptions: LINING_OPTIONS, stripType: 'sidewalk', liningType: 'lamp' }),
	template: `<div class="rs_side">
		<div class="rs_side_head"><strong>{{title}}</strong> <small>from road edge outward</small></div>
		<p v-if="!elements.length" class="rs_hint">Nothing here yet. Add a strip or a lining.</p>
		<component v-for="(e, i) in elements" :key="e.id" :is="e.kind === 'strip' ? 'rs-strip-row' : 'rs-lining-row'"
			:element="e" :first="i === 0" :last="i === elements.length - 1"
			@patch="p => $emit('patch', e.id, p)" @remove="$emit('remove', e.id)" @move="d => $emit('move', e.id, d)"></component>
		<div class="rs_add">
			<select v-model="stripType"><option v-for="o in stripOptions" :key="o.value" :value="o.value">{{o.label}}</option></select>
			<button @click="$emit('add-strip', stripType)">Add strip</button>
		</div>
		<div class="rs_add">
			<select v-model="liningType"><option v-for="o in liningOptions" :key="o.value" :value="o.value">{{o.label}}</option></select>
			<button @click="$emit('add-lining', liningType)">Add lining</button>
		</div>
	</div>`,
};

export type { SideElement, StripElement, TreeSpec };
