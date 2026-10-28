import type { SettingsPatch } from '../../core/defaults';
import type { Carriageway, LiningElement, RoadProfile, SideElement, Structure, StripElement } from '../../core/model';
import { addLining, addStrip, mirrorSide, moveElement, removeElement, updateLining, updateStrip } from '../../core/profile_edit';
import type { LiningType, StripType } from '../../core/model';
import type { RoadSession, Snapshot } from '../session';
import type { ComponentDefinition } from './component_types';
import { NumberField, Section, SelectField, ToggleField } from './fields';
import { SideStack } from './side_stack';
import { CarriagewayEditor } from './carriageway';
import { PANEL_CSS } from './styles';

type Side = 'left' | 'right';

interface PanelInstance {
	snap: Snapshot;
	status: string;
	session: RoadSession;
	options: { height: number; snap: number; surface: boolean; connect: boolean };
	[key: string]: unknown;
}

const STRUCTURE_OPTIONS = [
	{ value: 'auto', label: 'Automatic' },
	{ value: 'ground', label: 'Ground' },
	{ value: 'bridge', label: 'Bridge' },
	{ value: 'tunnel', label: 'Tunnel' },
];
const NODE_STYLES = [
	{ value: 'auto', label: 'Automatic' },
	{ value: 'junction', label: 'Always a junction' },
	{ value: 'through', label: 'Never a junction' },
];
const WEATHER = [
	{ value: 'spring', label: 'Dry' },
	{ value: 'wet', label: 'Wet colours' },
	{ value: 'snow', label: 'Snow' },
];
const END_CAPS = [
	{ value: 'round', label: 'Rounded' },
	{ value: 'flat', label: 'Open' },
];

function guard(panel: PanelInstance, action: () => void): void {
	try {
		action();
	} catch (error) {
		panel.status = (error as Error).message;
		console.error('Roadscape', error);
	}
}

function methods(): Record<string, (this: PanelInstance, ...args: never[]) => unknown> {
	return {
		pickProfile(id: string): void {
			guard(this, (): void => this.session.pickProfile(id));
		},
		editCarriageway(patch: Partial<Carriageway>): void {
			guard(this, (): void => this.session.editProfile((p: RoadProfile): RoadProfile => ({ ...p, carriageway: { ...p.carriageway, ...patch } })));
		},
		previewCarriageway(patch: Partial<Carriageway>): void {
			guard(this, (): void => this.session.previewProfile((p: RoadProfile): RoadProfile => ({ ...p, carriageway: { ...p.carriageway, ...patch } })));
		},
		editProfileStructure(structure: Structure): void {
			guard(this, (): void => this.session.editProfile((p: RoadProfile): RoadProfile => ({ ...p, structure })));
		},
		patchElement(side: Side, id: string, patch: Partial<StripElement> & Partial<LiningElement>): void {
			guard(this, (): void =>
				this.session.editProfile((p: RoadProfile): RoadProfile => {
					const element: SideElement | undefined = p[side].find((e: SideElement): boolean => e.id === id);
					return element?.kind === 'strip' ? updateStrip(p, side, id, patch) : updateLining(p, side, id, patch);
				}),
			);
		},
		removeElement(side: Side, id: string): void {
			guard(this, (): void => this.session.editProfile((p: RoadProfile): RoadProfile => removeElement(p, side, id)));
		},
		moveElement(side: Side, id: string, delta: -1 | 1): void {
			guard(this, (): void => this.session.editProfile((p: RoadProfile): RoadProfile => moveElement(p, side, id, delta)));
		},
		addStrip(side: Side, type: StripType): void {
			guard(this, (): void => this.session.editProfile((p: RoadProfile): RoadProfile => addStrip(p, side, type)));
		},
		addLining(side: Side, type: LiningType): void {
			guard(this, (): void => this.session.editProfile((p: RoadProfile): RoadProfile => addLining(p, side, type)));
		},
		mirror(from: Side): void {
			guard(this, (): void => this.session.editProfile((p: RoadProfile): RoadProfile => mirrorSide(p, from)));
		},
		duplicateProfile(): void {
			guard(this, (): void => this.session.editProfile((p: RoadProfile): RoadProfile => p, true, 'Copy road type'));
		},
		renameProfile(name: string): void {
			guard(this, (): void => this.session.editProfile((p: RoadProfile): RoadProfile => ({ ...p, name: name.trim() || p.name })));
		},
		setSettings(patch: SettingsPatch): void {
			guard(this, (): void => this.session.setSettings(patch));
		},
		previewSettings(patch: SettingsPatch): void {
			guard(this, (): void => this.session.previewSettings(patch));
		},
		setSegment(patch: { smooth?: boolean; structure?: Structure }): void {
			guard(this, (): void => this.session.setSegments(patch));
		},
		setNode(patch: { style?: 'auto' | 'junction' | 'through'; cornerRadius?: number }): void {
			guard(this, (): void => this.session.setNodes(patch));
		},
		resetCurves(): void {
			guard(this, (): void => this.session.resetCurves());
		},
		draw(): void {
			guard(this, (): void => this.session.startDrawing());
		},
		autoSetup(): void {
			guard(this, (): void => {
				const mesh: Mesh | null = this.session.manager.selected();
				if (!mesh) throw new Error('Select a road network first.');
				const created: number = this.session.manager.autoSetup(mesh);
				this.status = created > 0 ? `Created ${created} junction${created === 1 ? '' : 's'}.` : 'No new intersections found.';
			});
		},
		bake(): void {
			const mesh: Mesh | null = this.session.manager.selected();
			if (!mesh) return;
			this.session.manager.bake(mesh).catch((error: Error): void => {
				this.status = error.message;
			});
		},
		budgetPercent(): number {
			const stats = this.snap.stats;
			return stats ? Math.min(100, Math.round((stats.triangles / Math.max(1, stats.budget)) * 100)) : 0;
		},
	};
}

const TEMPLATE: string = `<div class="rs_panel">
	<div class="rs_row">
		<button class="rs_primary" @click="draw">Draw Road</button>
		<button :disabled="!snap.hasRoad" @click="autoSetup" title="Split and join every place roads meet or cross">Auto-setup junctions</button>
		<button :disabled="!snap.hasRoad" @click="bake" title="Replace the live road with ordinary meshes for export">Bake</button>
	</div>
	<p class="rs_status">{{status}}</p>
	<p v-if="snap.error" class="rs_warn">{{snap.error}}</p>

	<div v-if="snap.stats" class="rs_stats">
		<div>{{snap.stats.triangles.toLocaleString()}} / {{snap.stats.budget.toLocaleString()}} triangles · {{snap.stats.segments}} roads · {{snap.stats.nodes}} points</div>
		<div class="rs_meter" :class="{rs_over: snap.stats.triangles > snap.stats.budget}"><div :style="{width: budgetPercent() + '%'}"></div></div>
		<p v-if="snap.stats.treesPending" class="rs_hint">Growing trees…</p>
		<p v-for="w in snap.stats.warnings" class="rs_warn">{{w}}</p>
		<details><summary>Triangles by part</summary>
			<div class="rs_breakdown"><template v-for="b in snap.stats.breakdown"><span>{{b.name}}</span><span>{{b.triangles.toLocaleString()}}</span></template></div>
		</details>
	</div>
	<p v-else-if="!snap.hasRoad" class="rs_hint">Click Draw Road, then click in the viewport. Click on an existing road to connect to it; crossings become junctions automatically.</p>

	<rs-section :title="snap.hasRoad && snap.selectedSegments ? 'Road type (' + snap.selectedSegments + ' selected)' : 'Road type'">
		<label class="rs_field"><span>Type</span>
			<select :value="snap.profileId" @change="pickProfile($event.target.value)">
				<optgroup label="Library"><option v-for="p in snap.profiles" v-if="!p.custom" :key="p.id" :value="p.id">{{p.name}}</option></optgroup>
				<optgroup label="This project" v-if="snap.profiles.some(p => p.custom)"><option v-for="p in snap.profiles" v-if="p.custom" :key="p.id" :value="p.id">{{p.name}}</option></optgroup>
			</select>
		</label>
		<p class="rs_hint" v-if="snap.profile.builtin">Library road types are copied the moment you change them.</p>
		<p class="rs_hint" v-else>Used by {{snap.usage}} road{{snap.usage === 1 ? '' : 's'}}. Changes apply to all of them.</p>
		<div class="rs_row">
			<button @click="duplicateProfile" title="Give the selected roads their own copy of this type">Make own copy</button>
		</div>
		<label class="rs_field" v-if="!snap.profile.builtin"><span>Name</span><input type="text" :value="snap.profile.name" @change="renameProfile($event.target.value)"></label>
	</rs-section>

	<rs-section title="Road surface and lanes" :open="false">
		<rs-carriageway :value="snap.profile.carriageway" :structure="snap.profile.structure" @patch="editCarriageway" @preview="previewCarriageway" @structure="editProfileStructure"></rs-carriageway>
	</rs-section>

	<rs-section title="Roadside">
		<div class="rs_row"><button @click="mirror('left')">Copy left to right</button><button @click="mirror('right')">Copy right to left</button></div>
		<rs-side-stack title="Left side" :elements="snap.profile.left"
			@patch="(id, p) => patchElement('left', id, p)" @remove="id => removeElement('left', id)" @move="(id, d) => moveElement('left', id, d)"
			@add-strip="t => addStrip('left', t)" @add-lining="t => addLining('left', t)"></rs-side-stack>
		<rs-side-stack title="Right side" :elements="snap.profile.right"
			@patch="(id, p) => patchElement('right', id, p)" @remove="id => removeElement('right', id)" @move="(id, d) => moveElement('right', id, d)"
			@add-strip="t => addStrip('right', t)" @add-lining="t => addLining('right', t)"></rs-side-stack>
	</rs-section>

	<rs-section title="Selected roads and points" :open="false" v-if="snap.hasRoad">
		<p class="rs_hint" v-if="!snap.segment && !snap.node">Select road points in vertex mode to change them.</p>
		<template v-if="snap.segment">
			<rs-toggle label="Smooth curve" :value="snap.segment.smooth" @input="v => setSegment({smooth: v})"></rs-toggle>
			<rs-select label="Built as" :value="snap.segment.structure" :options="structures" @input="v => setSegment({structure: v})"></rs-select>
			<div class="rs_row"><button @click="resetCurves">Reset curve handles</button></div>
		</template>
		<template v-if="snap.node">
			<rs-select label="Junction" :value="snap.node.style" :options="nodeStyles" @input="v => setNode({style: v})"></rs-select>
			<rs-number label="Corner radius" suffix="m (-1 = default)" :value="snap.node.cornerRadius" :min="-1" :max="30" :step="0.5" @input="v => setNode({cornerRadius: v})"></rs-number>
		</template>
	</rs-section>

	<rs-section title="Junctions" :open="false">
		<rs-number label="Corner radius" suffix="m" :value="snap.settings.junction.cornerRadius" :min="0" :max="30" :step="0.5" @input="v => setSettings({junction: {cornerRadius: v}})"></rs-number>
		<rs-number label="Corner smoothness" :value="snap.settings.junction.cornerSegments" :min="1" :max="12" :step="1" @input="v => setSettings({junction: {cornerSegments: Math.round(v)}})"></rs-number>
		<rs-number label="Overpass clearance" suffix="m" :value="snap.settings.junction.clearance" :min="0" :max="30" :step="0.5" @input="v => setSettings({junction: {clearance: v}})"></rs-number>
		<rs-toggle label="Stop lines" :value="snap.settings.junction.stopLines" @input="v => setSettings({junction: {stopLines: v}})"></rs-toggle>
		<rs-select label="Dead ends" :value="snap.settings.junction.endCap" :options="endCaps" @input="v => setSettings({junction: {endCap: v}})"></rs-select>
	</rs-section>

	<rs-section title="Bridges and tunnels" :open="false">
		<rs-number label="Bridge above" suffix="m" :value="snap.settings.structures.bridgeThreshold" :min="0" :max="50" :step="0.5" @input="v => setSettings({structures: {bridgeThreshold: v}})"></rs-number>
		<rs-number label="Tunnel below" suffix="m" :value="snap.settings.structures.tunnelThreshold" :min="0" :max="50" :step="0.5" @input="v => setSettings({structures: {tunnelThreshold: v}})"></rs-number>
		<rs-number label="Pier spacing" suffix="m" :value="snap.settings.structures.pierSpacing" :min="4" :max="60" :step="1" @input="v => setSettings({structures: {pierSpacing: v}})"></rs-number>
		<rs-number label="Tunnel height" suffix="m" :value="snap.settings.structures.tunnelHeight" :min="3" :max="20" :step="0.5" @input="v => setSettings({structures: {tunnelHeight: v}})"></rs-number>
		<rs-number label="Fan spacing" suffix="m" :value="snap.settings.structures.fanSpacing" :min="8" :max="120" :step="1" @input="v => setSettings({structures: {fanSpacing: v}})"></rs-number>
	</rs-section>

	<rs-section title="Triangle budget" :open="false">
		<rs-number label="Budget" suffix="triangles" :value="snap.settings.budget.maxTriangles" :min="500" :max="500000" :step="500" @input="v => setSettings({budget: {maxTriangles: Math.round(v)}})"></rs-number>
		<rs-toggle label="Thin props to fit the budget" :value="snap.settings.budget.enforce" @input="v => setSettings({budget: {enforce: v}})"></rs-toggle>
		<p class="rs_hint">Thinning removes every n-th tree or lamp, trees first. Road surfaces and rails are never reduced.</p>
	</rs-section>

	<rs-section title="World" :open="false">
		<rs-number label="Model units per metre" :value="snap.settings.unitsPerMeter" :min="0.01" :max="64" :step="0.1" @input="v => setSettings({unitsPerMeter: v})"></rs-number>
		<rs-number label="Ground height" suffix="units" :value="snap.settings.groundY" :min="-1000" :max="1000" :step="0.5" @input="v => setSettings({groundY: v})"></rs-number>
		<rs-number label="Curve error" suffix="m" :value="snap.settings.curveError" :min="0.02" :max="2" :step="0.02" @input="v => setSettings({curveError: v})"></rs-number>
		<rs-select label="Weather" :value="snap.settings.weather" :options="weather" @input="v => setSettings({weather: v})"></rs-select>
	</rs-section>

	<rs-section title="Drawing" :open="false">
		<rs-number label="Drawing height" suffix="units" :value="options.height" :step="0.5" @input="v => options.height = v"></rs-number>
		<rs-number label="Grid snap" suffix="units" :value="options.snap" :min="0" :step="0.25" @input="v => options.snap = v"></rs-number>
		<rs-toggle label="Connect to existing roads" :value="options.connect" @input="v => options.connect = v"></rs-toggle>
		<rs-toggle label="Draw on surfaces" :value="options.surface" @input="v => options.surface = v"></rs-toggle>
		<p class="rs_hint">Shift locks an axis. Alt turns snapping off for one click. Click the first point again to close a loop.</p>
	</rs-section>
</div>`;

export interface PanelParts {
	css: string;
	component: Record<string, unknown>;
}

/** Builds the Vue definition of the sidebar. `refresh` is wired by the caller to road changes. */
export function buildPanelComponent(session: RoadSession, initial: Snapshot, onMounted: (instance: PanelInstance) => void): PanelParts {
	const component: ComponentDefinition = {
		components: {
			'rs-section': Section,
			'rs-number': NumberField,
			'rs-select': SelectField,
			'rs-toggle': ToggleField,
			'rs-side-stack': SideStack,
			'rs-carriageway': CarriagewayEditor,
		},
		data: (): Record<string, unknown> => ({
			snap: initial,
			status: 'Draw roads like a city builder: click to place points, click a road to connect.',
			session,
			options: session.drawOptions,
			structures: STRUCTURE_OPTIONS,
			nodeStyles: NODE_STYLES,
			weather: WEATHER,
			endCaps: END_CAPS,
		}),
		template: TEMPLATE,
		methods: methods() as never,
		mounted(this: unknown): void {
			onMounted(this as PanelInstance);
		},
	};
	return { css: PANEL_CSS, component: component as unknown as Record<string, unknown> };
}

export type { PanelInstance };
