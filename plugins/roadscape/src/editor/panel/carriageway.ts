import type { Carriageway, MarkingStyle, Structure } from '../../core/model';
import type { ComponentDefinition } from './component_types';
import { NumberField, SelectField, ToggleField } from './fields';
import { SURFACE_OPTIONS } from './side_stack';
import type { Option } from './side_stack';

const MARKINGS: Option[] = (['none', 'solid', 'dashed', 'double'] as MarkingStyle[]).map((m: MarkingStyle): Option => ({ value: m, label: m[0].toUpperCase() + m.slice(1) }));
const STRUCTURES: Option[] = (['auto', 'ground', 'bridge', 'tunnel'] as Structure[]).map((m: Structure): Option => ({ value: m, label: m[0].toUpperCase() + m.slice(1) }));
const LINE_COLORS: Option[] = [
	{ value: 'white', label: 'White' },
	{ value: 'yellow', label: 'Yellow' },
];
const CROSSWALKS: Option[] = [
	{ value: 'zebra', label: 'Zebra crossings' },
	{ value: 'none', label: 'None' },
];

/** Lanes, markings and surface of the road itself. */
export const CarriagewayEditor: ComponentDefinition = {
	name: 'rs-carriageway',
	components: { 'rs-number': NumberField, 'rs-select': SelectField, 'rs-toggle': ToggleField },
	props: ['value', 'structure'],
	data: (): Record<string, unknown> => ({ markings: MARKINGS, structures: STRUCTURES, colors: LINE_COLORS, crosswalks: CROSSWALKS, surfaces: SURFACE_OPTIONS }),
	template: `<div class="rs_body">
		<rs-number label="Lanes" :value="value.lanes" :min="1" :max="12" :step="1" @input="v => $emit('patch', {lanes: Math.round(v)})"></rs-number>
		<rs-number label="Lane width" suffix="m" :value="value.laneWidth" :min="2" :max="6" :step="0.05" @input="v => $emit('patch', {laneWidth: v})" @preview="v => $emit('preview', {laneWidth: v})"></rs-number>
		<rs-number label="Median" suffix="m" :value="value.medianWidth" :min="0" :max="12" :step="0.1" @input="v => $emit('patch', {medianWidth: v})"></rs-number>
		<rs-toggle v-if="value.medianWidth > 0 && value.medianWidth < 3" label="Barrier on median" :value="value.medianBarrier" @input="v => $emit('patch', {medianBarrier: v})"></rs-toggle>
		<rs-number label="Crown" suffix="m" :value="value.crown" :min="0" :max="0.3" :step="0.01" @input="v => $emit('patch', {crown: v})"></rs-number>
		<rs-select label="Surface" :value="value.surface" :options="surfaces" @input="v => $emit('patch', {surface: v})"></rs-select>
		<rs-select label="Centre line" :value="value.centerMarking" :options="markings" @input="v => $emit('patch', {centerMarking: v})"></rs-select>
		<rs-select label="Lane lines" :value="value.laneMarking" :options="markings" @input="v => $emit('patch', {laneMarking: v})"></rs-select>
		<rs-toggle label="Edge lines" :value="value.edgeLines" @input="v => $emit('patch', {edgeLines: v})"></rs-toggle>
		<rs-select label="Line colour" :value="value.lineColor" :options="colors" @input="v => $emit('patch', {lineColor: v})"></rs-select>
		<rs-select label="Crossings" :value="value.crosswalks" :options="crosswalks" @input="v => $emit('patch', {crosswalks: v})"></rs-select>
		<rs-select label="Built as" :value="structure" :options="structures" @input="v => $emit('structure', v)"></rs-select>
	</div>`,
};

export type { Carriageway };
