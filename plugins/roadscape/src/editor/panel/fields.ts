import type { ComponentDefinition } from './component_types';

function clampValue(this: { min?: number; max?: number }, n: number): number {
	if (!Number.isFinite(n)) return 0;
	const lo: number = this.min === undefined ? -Infinity : Number(this.min);
	const hi: number = this.max === undefined ? Infinity : Number(this.max);
	return Math.min(hi, Math.max(lo, n));
}

interface NumberInput {
 value: number;
 min?: number;
 max?: number;
 focused: boolean;
 draft: string;
 $emit(event: string, value: number): void;
}

/** Keep the user's in-progress text while live regeneration refreshes panel props. */
export const NumberField: ComponentDefinition = {
 name: 'rs-number',
 props: ['label', 'value', 'min', 'max', 'step', 'suffix'],
 data: () => ({ focused: false, draft: '' }),
 template: `<label class="rs_field">
  <span>{{label}}<em v-if="suffix"> {{suffix}}</em></span>
  <input type="number" :min="min" :max="max" :step="step" :value="focused ? draft : value"
   @focus="begin" @input="preview($event.target.value)" @change="commit($event.target.value)" @blur="focused = false"
   @keydown.enter.prevent="$event.target.blur()" @keydown.esc.stop.prevent="cancel($event.target)">
 </label>`,
 methods: {
  begin(this: NumberInput): void { this.focused = true; this.draft = String(this.value); },
  preview(this: NumberInput, text: string): void {
   this.focused = true; this.draft = text;
   if (text.trim() && Number.isFinite(Number(text))) this.$emit('preview', clampValue.call(this, Number(text)));
  },
  commit(this: NumberInput, text: string): void {
   if (!text.trim() || !Number.isFinite(Number(text))) { this.draft = String(this.value); this.$emit('preview', this.value); return; }
   const value = clampValue.call(this, Number(text)); this.draft = String(value);
   if (value !== Number(this.value)) this.$emit('input', value);
  },
  cancel(this: NumberInput, input: HTMLInputElement): void {
   this.draft = String(this.value); input.value = this.draft; this.$emit('preview', this.value); input.blur();
  },
 } as never,
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
