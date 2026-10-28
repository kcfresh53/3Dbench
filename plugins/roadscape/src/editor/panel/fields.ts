import type { ComponentDefinition } from './component_types';

function clampValue(this: { min?: number; max?: number }, n: number): number {
	if (!Number.isFinite(n)) return 0;
	const lo: number = this.min === undefined ? -Infinity : Number(this.min);
	const hi: number = this.max === undefined ? Infinity : Number(this.max);
	return Math.min(hi, Math.max(lo, n));
}

/** Labelled number input that previews while dragging and commits on change. */
export const NumberField: ComponentDefinition = {
	name: 'rs-number',
	props: ['label', 'value', 'min', 'max', 'step', 'suffix'],
	template: `<label class="rs_field">
		<span>{{label}}<em v-if="suffix"> {{suffix}}</em></span>
		<input type="number" :min="min" :max="max" :step="step" :value="value"
			@input="$emit('preview', Number($event.target.value))"
			@change="$emit('input', clamp(Number($event.target.value)))">
	</label>`,
	methods: { clamp: clampValue as never },
};

export const SelectField: ComponentDefinition = {
	name: 'rs-select',
	props: ['label', 'value', 'options'],
	template: `<label class="rs_field">
		<span>{{label}}</span>
		<select :value="value" @change="$emit('input', $event.target.value)">
			<option v-for="o in options" :key="o.value" :value="o.value">{{o.label}}</option>
		</select>
	</label>`,
};

export const ToggleField: ComponentDefinition = {
	name: 'rs-toggle',
	props: ['label', 'value'],
	template: `<label class="rs_field rs_toggle">
		<span>{{label}}</span>
		<input type="checkbox" :checked="value" @change="$emit('input', $event.target.checked)">
	</label>`,
};

export const Section: ComponentDefinition = {
	name: 'rs-section',
	props: ['title', 'open'],
	template: `<details class="rs_section" :open="open !== false"><summary>{{title}}</summary><div class="rs_body"><slot></slot></div></details>`,
};
