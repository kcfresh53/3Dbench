/** Minimal shape of a Vue 2 component definition, enough for typed plugin components. */
export interface ComponentDefinition {
	name?: string;
	props?: Record<string, unknown> | string[];
	data?: () => Record<string, unknown>;
	template: string;
	methods?: Record<string, (...args: never[]) => unknown>;
	computed?: Record<string, (this: never) => unknown>;
	components?: Record<string, ComponentDefinition>;
	mounted?: () => void;
}
