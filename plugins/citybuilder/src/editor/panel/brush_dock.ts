import type { CityController } from '../controller';
import type { ActiveTool } from '../controller';
import type { LandscapeMode, RoadPaintMode, RoadTypeModel } from '../tools/models';
import { icon } from './icons';
import type { IconName } from './icons';

interface ToolButton {
	id: string;
	icon: IconName;
	label: string;
	isActive: (c: CityController, active: ActiveTool) => boolean;
	run: (c: CityController) => void;
}

const LANDSCAPE: Array<[LandscapeMode, IconName, string]> = [
	['raise', 'raise', 'Raise terrain'],
	['lower', 'lower', 'Lower terrain'],
	['smooth', 'smooth', 'Smooth terrain'],
	['flatten', 'flatten', 'Flatten to the clicked height'],
	['level', 'level', 'Level to a plane'],
	['surface', 'biome', 'Paint ground surface'],
];

const PAINT_MODES: Array<[RoadPaintMode, IconName, string]> = [
	['brush', 'brush', 'Brush along a road'],
	['rect', 'rect', 'Rectangle'],
	['polygon', 'polygon', 'Polygon (Enter to apply)'],
];

const STRUCTURES: Array<[RoadTypeModel['structure'], IconName, string]> = [
	['keep', 'keep', 'Keep each road’s structure'],
	['ground', 'ground', 'Ground level'],
	['bridge', 'bridge', 'Bridge'],
	['tunnel', 'tunnel', 'Tunnel'],
	['air', 'air', 'Open span / jump'],
];

/**
 * The small tool bar floating over the viewport. Every tool is an icon with a tooltip; the options of
 * the active tool appear in a second row. The sidebar panel holds the precise controls.
 */
export class BrushDock {
	private readonly root: HTMLDivElement = document.createElement('div');
	private readonly tools: HTMLDivElement = document.createElement('div');
	private readonly options: HTMLDivElement = document.createElement('div');
	private readonly off: () => void;
	private readonly timer: ReturnType<typeof setInterval>;
	private collapsed: boolean = false;
	private last: string = '';

	constructor(private readonly ctl: CityController) {
		this.root.className = 'city_brush_dock';
		this.root.setAttribute('role', 'toolbar');
		this.root.setAttribute('aria-label', 'City tools');
		this.root.append(this.tools, this.options);
		for (const event of ['pointerdown', 'pointerup', 'click', 'wheel']) this.root.addEventListener(event, (e: Event): void => e.stopPropagation());
		this.off = ctl.changed.on((): void => this.update());
		this.timer = setInterval((): void => this.attach(), 400);
		this.attach();
		this.update();
	}

	private attach(): void {
		const host: HTMLElement | null | undefined = Preview.selected?.canvas?.parentElement;
		if (host && this.root.parentElement !== host) host.append(this.root);
		this.root.hidden = !this.ctl.store.state || !Modes.edit;
	}

	private button(name: IconName, label: string, action: () => void, active: boolean = false): HTMLButtonElement {
		const b: HTMLButtonElement = document.createElement('button');
		b.type = 'button';
		b.title = label;
		b.setAttribute('aria-label', label);
		b.classList.toggle('active', active);
		b.setAttribute('aria-pressed', String(active));
		b.append(icon(name));
		b.onclick = action;
		return b;
	}

	private divider(parent: HTMLElement): void {
		const d: HTMLSpanElement = document.createElement('span');
		d.className = 'city_dock_sep';
		parent.append(d);
	}

	private group(buttons: HTMLButtonElement[], parent: HTMLElement): void {
		parent.append(...buttons);
	}

	private update(): void {
		this.attach();
		const c: CityController = this.ctl;
		const active: ActiveTool = c.activeTool();
		const signature: string = JSON.stringify([active, c.landscape, c.district, c.roadType, c.roundabout, c.ramp, c.roadEditor.profileChoices(), this.collapsed, c.busy]);
		if (signature === this.last) return;
		this.last = signature;
		this.tools.replaceChildren();
		this.options.replaceChildren();
		this.tools.append(this.button(this.collapsed ? 'chevron_up' : 'chevron_down', this.collapsed ? 'Show city tools' : 'Hide city tools', (): void => { this.collapsed = !this.collapsed; this.update(); }));
		if (this.collapsed) return;
		this.group([this.button('select', 'Select (back to the normal tools)', (): void => { c.deselectTools(); this.last = ''; this.update(); }, active === 'none')], this.tools);
		this.divider(this.tools);
		this.group(LANDSCAPE.map(([mode, name, label]) => this.button(name, label, (): void => c.pickLandscape(mode), active === 'landscape' && c.landscape.mode === mode)), this.tools);
		this.divider(this.tools);
		this.group([this.button('district', 'Zone districts', (): void => c.pickDistrictMode('brush'), active === 'zoning')], this.tools);
		this.divider(this.tools);
		const roadTools: ToolButton[] = [
			{ id: 'draw', icon: 'road', label: 'Draw roads (Roadscape)', isActive: () => false, run: (k) => k.drawRoads() },
			{ id: 'roundabout', icon: 'roundabout', label: 'Roundabout: click a junction', isActive: (_k, a) => a === 'roundabout', run: (k) => k.pickRoundabout() },
			{ id: 'ramp', icon: 'ramp', label: 'Highway ramp: click beside a road', isActive: (_k, a) => a === 'ramp', run: (k) => k.pickRamp() },
			{ id: 'roadtype', icon: 'roadtype', label: 'Road type: paint bridges, tunnels and road profiles', isActive: (_k, a) => a === 'roadtype', run: (k) => k.pickRoadType(k.roadType.mode) },
		];
		this.group(roadTools.map((t: ToolButton) => this.button(t.icon, t.label, (): void => t.run(c), t.isActive(c, active))), this.tools);
		if (active === 'none') return;
		if (active === 'roadtype') this.roadTypeOptions();
		else if (active === 'roundabout') this.roundaboutOptions();
		else if (active === 'ramp') this.rampOptions();
		else this.paintOptions(active);
	}

	private slider(label: string, unit: string, min: number, max: number, value: number, change: (v: number) => void): HTMLLabelElement {
		const input: HTMLInputElement = document.createElement('input');
		input.type = 'range';
		input.min = String(min);
		input.max = String(max);
		input.step = '1';
		input.value = String(value);
		input.setAttribute('aria-label', label);
		const text: HTMLLabelElement = document.createElement('label');
		text.title = label;
		text.append(`${label} ${value} ${unit} `, input);
		input.onchange = (): void => change(Number(input.value));
		return text;
	}

	private select(label: string, entries: Array<[string, string]>, value: string, change: (v: string) => void): HTMLSelectElement {
		const select: HTMLSelectElement = document.createElement('select');
		select.setAttribute('aria-label', label);
		select.title = label;
		for (const [id, name] of entries) select.add(new Option(name, id));
		select.value = value;
		select.onchange = (): void => change(select.value);
		return select;
	}

	private roadTypeOptions(): void {
		const c: CityController = this.ctl;
		const m: RoadTypeModel = c.roadType;
		this.group(PAINT_MODES.map(([mode, name, label]) => this.button(name, label, (): void => c.pickRoadType(mode), m.mode === mode)), this.options);
		this.divider(this.options);
		this.group(STRUCTURES.map(([id, name, label]) => this.button(name, label, (): void => c.setRoadType('structure', id), m.structure === id)), this.options);
		const profiles: Array<[string, string]> = [['', 'Keep road profile'], ...c.roadEditor.profileChoices().map((p): [string, string] => [p.id, p.name])];
		this.options.append(this.select('Road profile to paint', profiles, m.profile, (v: string): void => c.setRoadType('profile', v)));
		if (m.mode === 'brush') this.options.append(this.slider('Radius', 'm', 2, 200, m.radius, (v: number): void => c.setRoadType('radius', v)));
	}

	private roundaboutOptions(): void {
		const c: CityController = this.ctl;
		this.options.append(this.slider('Radius', 'm', 8, 120, c.roundabout.radius, (v: number): void => c.setRoundabout('radius', v)));
		this.group(
			[
				this.button('hand_right', 'Drive on the right (counter-clockwise)', (): void => c.setRoundabout('hand', 'right'), c.roundabout.hand === 'right'),
				this.button('hand_left', 'Drive on the left (clockwise)', (): void => c.setRoundabout('hand', 'left'), c.roundabout.hand === 'left'),
			],
			this.options,
		);
		const profiles: Array<[string, string]> = [['', 'Ring profile: automatic'], ...c.roadEditor.profileChoices().map((p): [string, string] => [p.id, p.name])];
		this.options.append(this.select('Ring road profile', profiles, c.roundabout.profile, (v: string): void => c.setRoundabout('profile', v)));
	}

	private rampOptions(): void {
		const c: CityController = this.ctl;
		this.group(
			[
				this.button('ramp', 'Exit ramp: traffic leaves the highway', (): void => c.setRamp('kind', 'exit'), c.ramp.kind === 'exit'),
				this.button('road', 'Entry ramp: traffic joins the highway', (): void => c.setRamp('kind', 'entry'), c.ramp.kind === 'entry'),
				this.button('hand_right', 'Highway traffic runs in the order the road was drawn', (): void => c.setRamp('travel', 'forward'), c.ramp.travel === 'forward'),
				this.button('hand_left', 'Highway traffic runs against the order the road was drawn', (): void => c.setRamp('travel', 'backward'), c.ramp.travel === 'backward'),
			],
			this.options,
		);
		this.options.append(this.slider('Length', 'm', 30, 300, c.ramp.length, (v: number): void => c.setRamp('length', v)));
		this.options.append(this.slider('Turn', '°', 10, 80, c.ramp.turn, (v: number): void => c.setRamp('turn', v)));
		this.options.append(this.slider('Height', 'm', -12, 12, c.ramp.rise, (v: number): void => c.setRamp('rise', v)));
		const profiles: Array<[string, string]> = [['', 'Ramp profile: built-in ramp'], ...c.roadEditor.profileChoices().map((p): [string, string] => [p.id, p.name])];
		this.options.append(this.select('Ramp road profile', profiles, c.ramp.profile, (v: string): void => c.setRamp('profile', v)));
	}

	private paintOptions(active: ActiveTool): void {
		const c: CityController = this.ctl;
		const zoning: boolean = active === 'zoning';
		if (zoning) {
			this.options.append(this.select('District', c.districts.map((d): [string, string] => [String(d.id), d.label]), String(c.district.id), (v: string): void => c.pickDistrictType(Number(v))));
			this.options.append(this.button('erase', 'Erase districts', (): void => c.pickDistrictMode('erase'), c.district.mode === 'erase'));
		} else if (c.landscape.mode === 'surface') {
			const entries: Array<[string, string]> = [...c.surfaces.map((s): [string, string] => [String(s.id), s.label]), ['0', 'Automatic']];
			this.options.append(this.select('Surface', entries, String(c.landscape.surface), (v: string): void => c.setLandscape('surface', Number(v))));
		}
		this.options.append(this.slider('Radius', 'm', 4, 300, zoning ? c.district.radius : c.landscape.brush.radius, (v: number): void => (zoning ? c.setDistrict('radius', v) : c.setLandscape('brush.radius', v))));
		if (!zoning && c.landscape.mode !== 'surface') {
			const strength: HTMLInputElement = document.createElement('input');
			strength.type = 'number';
			strength.min = '.02';
			strength.max = '1';
			strength.step = '.02';
			strength.value = String(c.landscape.brush.strength);
			strength.setAttribute('aria-label', 'Brush strength');
			strength.title = 'Brush strength';
			strength.onchange = (): void => c.setLandscape('brush.strength', Math.max(0.02, Math.min(1, Number(strength.value) || 0.02)));
			this.options.append(strength);
		}
	}

	dispose(): void {
		this.off();
		clearInterval(this.timer);
		this.root.remove();
	}
}

export const BRUSH_DOCK_CSS: string = `.city_brush_dock{position:absolute;bottom:16px;left:16px;z-index:12;width:max-content;max-width:calc(100% - 32px);padding:6px;background:var(--color-back);color:var(--color-text);border:1px solid var(--color-border);border-radius:12px;box-shadow:0 4px 20px #0006;pointer-events:auto}.city_brush_dock[hidden]{display:none}.city_brush_dock>div{display:flex;align-items:center;justify-content:flex-start;gap:4px;flex-wrap:wrap}.city_brush_dock>div+div:not(:empty){margin-top:6px}.city_brush_dock button{min-width:0;min-height:0;width:32px;height:32px;padding:0;border-radius:6px;display:inline-flex;align-items:center;justify-content:center}.city_brush_dock button svg{display:block;pointer-events:none}.city_brush_dock button.active{background:var(--color-accent);color:var(--color-accent_text)}.city_dock_sep{width:1px;height:22px;background:var(--color-border);margin:0 3px}.city_brush_dock label{font-size:12px;white-space:nowrap}.city_brush_dock input[type=range]{width:100px;vertical-align:middle}.city_brush_dock input[type=number]{width:60px}.city_brush_dock select{max-width:170px}`;
