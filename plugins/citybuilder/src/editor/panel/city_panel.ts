import type { ComponentDefinition } from '../../../../roadscape/src/editor/panel/component_types';
import { NumberField, Section, SelectField, ToggleField } from '../../../../roadscape/src/editor/panel/fields';
import type { CityController, PanelSnapshot } from '../controller';
import { CITY_PANEL_CSS } from './styles';

export interface PanelInstance {
	snap: PanelSnapshot;
	status: string;
	[key: string]: unknown;
}

export interface PanelParts {
	css: string;
	component: Record<string, unknown>;
}

const LANDSCAPE_MODES: Array<{ id: string; label: string; hint: string }> = [
	{ id: 'raise', label: 'Raise', hint: 'Lift the ground (Ctrl lowers)' },
	{ id: 'lower', label: 'Lower', hint: 'Dig the ground (Ctrl raises)' },
	{ id: 'smooth', label: 'Smooth', hint: 'Relax bumps' },
	{ id: 'flatten', label: 'Flatten', hint: 'Pull everything to the height under the first click' },
	{ id: 'level', label: 'Level', hint: 'Push towards a fixed height' },
	{ id: 'noise', label: 'Roughen', hint: 'Add natural unevenness' },
	{ id: 'erode', label: 'Erode', hint: 'Let steep slopes crumble' },
	{ id: 'terrace', label: 'Terrace', hint: 'Cut steps into slopes' },
	{ id: 'surface', label: 'Paint ground', hint: 'Paint biomes: sand grows palms, loamy soil grows broadleaf trees, snow grows pines' },
];
const DISTRICT_MODES: Array<{ id: string; label: string }> = [
	{ id: 'brush', label: 'Brush' },
	{ id: 'rect', label: 'Rectangle' },
	{ id: 'polygon', label: 'Polygon' },
	{ id: 'fill', label: 'Fill' },
	{ id: 'road', label: 'Along road' },
	{ id: 'erase', label: 'Erase' },
];
const FALLOFF: Array<{ value: string; label: string }> = [
	{ value: 'smooth', label: 'Smooth' },
	{ value: 'linear', label: 'Linear' },
	{ value: 'sharp', label: 'Sharp' },
	{ value: 'flat', label: 'Flat' },
];
const SHAPE: Array<{ value: string; label: string }> = [
	{ value: 'round', label: 'Round' },
	{ value: 'square', label: 'Square' },
];
const SIZES: Array<{ value: string; label: string }> = [
	{ value: '129', label: 'Small (129 points)' },
	{ value: '193', label: 'Medium (193 points)' },
	{ value: '257', label: 'Large (257 points)' },
	{ value: '385', label: 'Huge (385 points)' },
];
const ATLAS: Array<{ value: string; label: string }> = [
	{ value: '512', label: '512 px' },
	{ value: '1024', label: '1024 px' },
	{ value: '2048', label: '2048 px' },
	{ value: '4096', label: '4096 px' },
];
const COLLISION: Array<{ value: string; label: string }> = [
	{ value: 'boxes', label: 'Boxes' },
	{ value: 'none', label: 'None' },
];

const ISLAND_SHAPES: Array<{ value: string; label: string }> = [
	{ value: 'round', label: 'Round' },
	{ value: 'rounded square', label: 'Rounded square' },
];
const KINDS: Array<{ value: string; label: string }> = [
	{ value: 'city', label: 'City' },
	{ value: 'track', label: 'Race track / road scene' },
	{ value: 'landscape', label: 'Landscape only' },
];
const KIND_HINTS: Record<string, string> = {
	city: 'Zoned districts fill with buildings and trees.',
	track: 'Terrain, roads and trees without buildings; export is ready for track scenery.',
	landscape: 'Terrain and roads only.',
};
const HANDS: Array<{ value: string; label: string }> = [
	{ value: 'right', label: 'The right' },
	{ value: 'left', label: 'The left' },
];
const PAINT_MODES: Array<{ id: string; label: string }> = [
	{ id: 'brush', label: 'Brush' },
	{ id: 'rect', label: 'Rectangle' },
	{ id: 'polygon', label: 'Polygon' },
];

const TEMPLATE: string = `<div class="rs_panel">
	<p class="rs_status" role="status" :title="status">{{status}}</p>
	<p v-if="snap.busy" class="cb_busy">{{snap.busy}}…</p>

	<rs-section v-if="!snap.hasCity" title="New city">
		<rs-select label="Project type" :value="create.kind" :options="kinds" @input="create.kind = $event"></rs-select>
		<p class="rs_hint">{{kindHint(create.kind)}}</p>
		<rs-select label="Map size" :value="String(create.size)" :options="sizes" @input="create.size = Number($event)"></rs-select>
		<rs-number label="Point spacing" suffix="m" :value="create.cellSize" :min="2" :max="24" :step="1" @input="create.cellSize = $event"></rs-number>
		<rs-select label="Landscape" :value="create.preset" :options="presetOptions" @input="create.preset = $event"></rs-select>
		<rs-number label="Seed" :value="create.seed" :min="0" :max="99999" :step="1" @input="create.seed = $event"></rs-number>
		<p class="rs_hint">{{create.size * create.cellSize}} m wide. Roads are read from Roadscape networks in this project.</p>
		<div class="rs_row"><button class="rs_primary" :disabled="!!snap.busy" @click="ctl.create(create)">Create city</button></div>
	</rs-section>

	<template v-if="snap.hasCity">
        <nav class="cb_tabs" aria-label="City workspace">
            <button v-for="t in tabs" :key="t.id" :class="{cb_on: tab === t.id}" :aria-pressed="tab === t.id" @click="tab = t.id">{{t.label}}</button>
        </nav>
		<div class="cb_stats" v-if="snap.stats">
			<div v-if="snap.settings.features.buildings"><b>{{snap.stats.buildings}}</b><small>buildings</small></div>
			<div v-if="snap.settings.features.buildings"><b>{{snap.stats.lots}}</b><small>lots</small></div>
			<div v-if="snap.settings.features.trees"><b>{{snap.stats.trees}}</b><small>trees</small></div>
			<div><b>{{snap.roadCount}}</b><small>road pieces</small></div>
			<div><b>{{snap.composeMs}} ms</b><small>build time</small></div>
		</div>

		<rs-section v-show="tab === 'project'" title="Project">
			<rs-select label="Project type" :value="snap.settings.kind" :options="kinds" @input="ctl.setKind($event)"></rs-select>
			<p class="rs_hint">{{kindHint(snap.settings.kind)}} The type only picks defaults; every option below stays editable.</p>
			<rs-toggle label="Generate buildings" :value="snap.settings.features.buildings" @input="ctl.setSetting('features.buildings', $event)"></rs-toggle>
			<rs-toggle label="Generate trees" :value="snap.settings.features.trees" @input="ctl.setSetting('features.trees', $event)"></rs-toggle>
			<p class="rs_hint">Export includes</p>
			<rs-toggle label="Terrain" :value="snap.settings.export.terrain" @input="ctl.setSetting('export.terrain', $event)"></rs-toggle>
			<rs-toggle label="Buildings" :value="snap.settings.export.buildings" @input="ctl.setSetting('export.buildings', $event)"></rs-toggle>
			<rs-toggle label="Trees" :value="snap.settings.export.trees" @input="ctl.setSetting('export.trees', $event)"></rs-toggle>
			<p class="rs_hint">Water is never exported. The manifest records the water level so your engine can place its own.</p>
		</rs-section>

		<rs-section v-show="tab === 'roads'" title="Roads & layout">
			<div class="rs_row"><button class="rs_primary" :disabled="!!snap.busy || !snap.hasRoadscape" @click="ctl.generateLayout()">Generate editable layout…</button></div>
			<div class="rs_row">
				<button class="rs_primary" :disabled="!snap.hasRoadscape" @click="ctl.drawRoads()" title="Opens the Roadscape Draw Road tool">Draw roads</button>
				<button @click="ctl.drape()" title="Move road points onto the terrain, so roads follow the land">Drape roads on terrain</button>
			</div>
			<p class="rs_hint" v-if="!snap.hasRoadscape">Load the Roadscape plugin to draw roads.</p>
			<p class="rs_hint">{{snap.roadCount}} road segment{{snap.roadCount === 1 ? '' : 's'}} found.</p>
			<div class="rs_row"><button @click="ctl.roadElevation()" title="Select a connected road chain, then set endpoint heights and vertical easing">Ramp / elevation…</button></div>
            <details class="rs_section"><summary>Roundabouts</summary><div class="rs_body">
            <p class="rs_hint"><b>Roundabout</b>: click a junction in the viewport.</p>
			<rs-number label="Radius" suffix="m" :value="snap.roundabout.radius" :min="8" :max="120" :step="1" @input="ctl.setRoundabout('radius', $event)"></rs-number>
			<rs-select label="Traffic drives on" :value="snap.roundabout.hand" :options="hands" @input="ctl.setRoundabout('hand', $event)"></rs-select>
			<rs-select label="Ring profile" :value="snap.roundabout.profile" :options="profileOptions(snap.profiles, 'Automatic')" @input="ctl.setRoundabout('profile', $event)"></rs-select>
			<div class="rs_row"><button :class="{cb_on: snap.activeTool === 'roundabout'}" @click="ctl.pickRoundabout()">Roundabout tool</button></div>
			</div></details>
            <p class="rs_hint"><b>Road type</b>: paint where a road becomes a bridge, tunnel, open span or another profile. Roads are cut at the edges of the painted area.</p>
			<rs-select label="Structure" :value="snap.roadType.structure" :options="structureOptions(snap.structures)" @input="ctl.setRoadType('structure', $event)"></rs-select>
			<rs-select label="Road profile" :value="snap.roadType.profile" :options="profileOptions(snap.profiles, 'Keep each road’s own')" @input="ctl.setRoadType('profile', $event)"></rs-select>
			<div class="cb_modes">
				<button v-for="m in paintModes" :key="m.id" :class="{cb_on: snap.activeTool === 'roadtype' && snap.roadType.mode === m.id}" @click="ctl.pickRoadType(m.id)">{{m.label}}</button>
			</div>
			<rs-number v-if="snap.roadType.mode === 'brush'" label="Brush size" suffix="m" :value="snap.roadType.radius" :min="2" :max="200" :step="1" @input="ctl.setRoadType('radius', $event)"></rs-number>
			<details class="rs_section"><summary>Terrain fitting & automatic bridges</summary><div class="rs_body">
            <rs-toggle label="Terrain follows roads" :value="snap.settings.conform.roads" @input="ctl.setSetting('conform.roads', $event)"></rs-toggle>
			<rs-number label="Ground tolerance" suffix="m" :value="snap.settings.conform.groundTolerance" :min="0" :max="60" :step="1" @input="ctl.setSetting('conform.groundTolerance', $event)"></rs-number>
			<p class="rs_hint">Gap height threshold for automatic bridges. Water crossings are detected separately. Explicit Ground, Bridge, Tunnel and Open span segments keep their chosen behavior.</p>
			<rs-toggle label="Automatic bridges over water / gaps" :value="snap.settings.conform.autoBridges" @input="ctl.setSetting('conform.autoBridges', $event)"></rs-toggle>
			<rs-number label="Minimum bridge span" suffix="m" :value="snap.settings.conform.bridgeSpan" :min="2" :max="100" :step="1" @input="ctl.setSetting('conform.bridgeSpan', $event)"></rs-number>
			<rs-number label="Road shoulder blend" suffix="m" :value="snap.settings.conform.roadBlend" :min="0" :max="80" :step="1" @input="ctl.setSetting('conform.roadBlend', $event)"></rs-number>
			<p class="rs_hint">Roadscape segment settings override automation. Use Open span / jump for unsupported sections. Drape is optional and changes control-point heights; avoid it on authored ramps.</p>
			<rs-number label="Embankment" suffix="m per m" :value="snap.settings.conform.embankment" :min="0.5" :max="8" :step="0.1" @input="ctl.setSetting('conform.embankment', $event)"></rs-number>
            </div></details>
		</rs-section>

		<rs-section v-show="tab === 'terrain'" title="Landscape">
			<div class="cb_modes">
				<button v-for="m in landscapeModes" :key="m.id" :title="m.hint" :class="{cb_on: snap.activeTool === 'landscape' && snap.landscape.mode === m.id}" @click="ctl.pickLandscape(m.id)">{{m.label}}</button>
			</div>
			<rs-number label="Brush size" suffix="m" :value="snap.landscape.brush.radius" :min="2" :max="300" :step="1" @input="ctl.setLandscape('brush.radius', $event)"></rs-number>
			<rs-number label="Strength" :value="snap.landscape.brush.strength" :min="0.02" :max="1" :step="0.02" @input="ctl.setLandscape('brush.strength', $event)"></rs-number>
			<rs-select label="Falloff" :value="snap.landscape.brush.falloff" :options="falloff" @input="ctl.setLandscape('brush.falloff', $event)"></rs-select>
			<rs-select label="Shape" :value="snap.landscape.brush.shape" :options="shape" @input="ctl.setLandscape('brush.shape', $event)"></rs-select>
			<rs-number v-if="snap.landscape.mode === 'level'" label="Target height" suffix="m" :value="snap.landscape.brush.targetHeight" :min="-200" :max="400" :step="0.5" @input="ctl.setLandscape('brush.targetHeight', $event)"></rs-number>
			<rs-number v-if="snap.landscape.mode === 'noise'" label="Roughness scale" suffix="m" :value="snap.landscape.brush.noiseScale" :min="4" :max="200" :step="1" @input="ctl.setLandscape('brush.noiseScale', $event)"></rs-number>
			<rs-number v-if="snap.landscape.mode === 'terrace'" label="Step height" suffix="m" :value="snap.landscape.brush.terraceStep" :min="0.5" :max="20" :step="0.5" @input="ctl.setLandscape('brush.terraceStep', $event)"></rs-number>
			<p v-if="snap.landscape.mode === 'surface'">Ground paint also sets the biome: sand → palms, loamy soil → broadleaf, snow → pine. Paved, gravel and rock stay clear.</p>
			<div v-if="snap.landscape.mode === 'surface'" class="cb_swatches">
				<button v-for="s in surfaces" :key="s.id" class="cb_zone" :class="{cb_on: snap.landscape.surface === s.id}" @click="ctl.setLandscape('surface', s.id)"><i :style="{background: s.color}"></i><span>{{s.label}}</span></button>
				<button class="cb_zone" :class="{cb_on: snap.landscape.surface === 0}" @click="ctl.setLandscape('surface', 0)"><i style="background:linear-gradient(135deg,#8c8,#ca8)"></i><span>Automatic</span></button>
			</div>
			<p class="rs_hint">Drag on the terrain. Ctrl swaps raise and lower. [ and ] resize the brush.</p>
			<div class="rs_row">
				<button @click="ctl.smoothTerrain()">Smooth all</button>
				<button @click="ctl.raiseTerrain(1)">+1 m</button>
				<button @click="ctl.raiseTerrain(-1)">−1 m</button>
			</div>
			<rs-select label="Regenerate" :value="regen.preset" :options="presetOptions" @input="regen.preset = $event"></rs-select>
			<rs-toggle label="With island edges" :value="regen.island" @input="regen.island = $event"></rs-toggle>
			<div class="rs_row"><button @click="ctl.regenerate(regen.preset, snap.settings.seed + 1, regen.island)" title="Replaces the terrain; undoable">Generate new terrain</button></div>
			<p class="rs_hint"><b>Island edges</b> bend the border of the current map down into the sea with a natural, ragged coastline. The water level decides where the shore is.</p>
			<rs-toggle label="Add ground first" :value="snap.island.grow" @input="ctl.setIsland('grow', $event)"></rs-toggle>
			<p class="rs_hint">On: the map grows by new ground on every side and the island forms there, so existing roads, buildings and sculpting are not sunk. Off: the existing edges are lowered instead (shape applies only then).</p>
			<rs-number label="Edge width" :value="snap.island.width" :min="0.05" :max="0.7" :step="0.01" @input="ctl.setIsland('width', $event)"></rs-number>
			<rs-number label="Sea floor depth" suffix="m" :value="snap.island.depth" :min="1" :max="80" :step="1" @input="ctl.setIsland('depth', $event)"></rs-number>
			<rs-number label="Coast roughness" :value="snap.island.roughness" :min="0" :max="1" :step="0.05" @input="ctl.setIsland('roughness', $event)"></rs-number>
			<rs-select label="Island shape" :value="snap.island.shape" :options="islandShapes" @input="ctl.setIsland('shape', $event)"></rs-select>
			<div class="rs_row"><button @click="ctl.islandEdges()" title="Lowers the land near the border below the water line; undoable">Apply island edges</button></div>
			<rs-number label="Water level" suffix="m" :value="snap.settings.waterLevel" :min="-50" :max="200" :step="0.5" @input="ctl.setSetting('waterLevel', $event)"></rs-number>
		</rs-section>

		<rs-section v-show="tab === 'terrain'" title="Water preview" :open="false">
			<p class="rs_hint">Only for looking at the scene. Water is not exported; your engine renders its own with the same parameters.</p>
			<rs-toggle label="Show water" :value="snap.settings.water.show" @input="ctl.setSetting('water.show', $event)"></rs-toggle>
			<rs-toggle label="Animate" :value="snap.settings.water.animate" @input="ctl.setSetting('water.animate', $event)"></rs-toggle>
			<div class="rs_row"><label>Colour <input type="color" :value="waterHex(snap.settings.water.color)" @change="setWaterColor($event.target.value)"></label></div>
			<rs-number label="Colour ratio" :value="snap.settings.water.colorRatio" :min="0" :max="1" :step="0.01" @input="ctl.setSetting('water.colorRatio', $event)"></rs-number>
			<rs-number label="Opacity" :value="snap.settings.water.alphaScale" :min="0" :max="1" :step="0.05" @input="ctl.setSetting('water.alphaScale', $event)"></rs-number>
			<rs-number label="Roughness" :value="snap.settings.water.roughness" :min="0.02" :max="1" :step="0.02" @input="ctl.setSetting('water.roughness', $event)"></rs-number>
			<rs-number label="Ripple strength" :value="snap.settings.water.normal" :min="0" :max="2" :step="0.05" @input="ctl.setSetting('water.normal', $event)"></rs-number>
			<rs-number label="Ripple speed" :value="snap.settings.water.timeScale" :min="0" :max="5" :step="0.1" @input="ctl.setSetting('water.timeScale', $event)"></rs-number>
			<rs-number label="Texture tiling" :value="snap.settings.water.uvScale" :min="1" :max="200" :step="1" @input="ctl.setSetting('water.uvScale', $event)"></rs-number>
			<rs-number label="Depth fade" suffix="m" :value="snap.settings.water.depthDistance" :min="0.5" :max="60" :step="0.5" @input="ctl.setSetting('water.depthDistance', $event)"></rs-number>
			<rs-number label="Foam" :value="snap.settings.water.foamIntensity" :min="0" :max="2" :step="0.05" @input="ctl.setSetting('water.foamIntensity', $event)"></rs-number>
			<rs-number label="Foam width" suffix="m" :value="snap.settings.water.foamWidth" :min="0" :max="2" :step="0.05" @input="ctl.setSetting('water.foamWidth', $event)"></rs-number>
			<rs-number label="Shore fade" suffix="m" :value="snap.settings.water.shoreFadeDistance" :min="0" :max="10" :step="0.1" @input="ctl.setSetting('water.shoreFadeDistance', $event)"></rs-number>
		</rs-section>

		<rs-section v-show="tab === 'districts'" title="Districts">
			<div class="cb_zones">
				<button v-for="d in districts" :key="d.id" class="cb_zone" :class="{cb_on: snap.district.id === d.id && snap.district.mode !== 'erase'}" :title="d.label" @click="ctl.pickDistrictType(d.id)"><i :style="{background: d.color}"></i><span>{{d.label}}</span></button>
			</div>
			<div class="cb_modes">
				<button v-for="m in districtModes" :key="m.id" :class="{cb_on: snap.activeTool === 'zoning' && snap.district.mode === m.id}" @click="ctl.pickDistrictMode(m.id)">{{m.label}}</button>
			</div>
			<rs-number v-if="snap.district.mode === 'brush' || snap.district.mode === 'erase'" label="Brush size" suffix="m" :value="snap.district.radius" :min="4" :max="300" :step="1" @input="ctl.setDistrict('radius', $event)"></rs-number>
			<rs-select v-if="snap.district.mode === 'brush' || snap.district.mode === 'erase'" label="Shape" :value="snap.district.shape" :options="shape" @input="ctl.setDistrict('shape', $event)"></rs-select>
			<rs-number label="Depth from road" suffix="m" :value="snap.district.depth" :min="10" :max="120" :step="2" @input="ctl.setDistrict('depth', $event)"></rs-number>
			<rs-toggle label="Keep existing zones" :value="snap.district.onlyUnzoned" @input="ctl.setDistrict('onlyUnzoned', $event)"></rs-toggle>
			<div class="rs_row">
				<button class="rs_primary" @click="ctl.zoneAllRoads()" title="Zone the ground beside every road with the selected district">Zone along all roads</button>
				<button @click="ctl.clearZones()">Clear all</button>
			</div>
			<rs-toggle label="Show districts" :value="snap.display.districts" @input="ctl.setDisplay('districts', $event)"></rs-toggle>
			<rs-toggle label="Show lots" :value="snap.display.lots" @input="ctl.setDisplay('lots', $event)"></rs-toggle>
		</rs-section>

		<rs-section v-if="snap.settings.features.buildings || snap.settings.features.trees" v-show="tab === 'districts'" title="Growth">
			<rs-number label="Development" :value="snap.settings.development" :min="0" :max="1" :step="0.05" @input="ctl.setSetting('development', $event)"></rs-number>
			<p class="rs_hint">Raise it to watch zoned lots fill up and grow taller. Buildings never move; they only appear and rise.</p>
			<rs-number label="Look variants" :value="snap.settings.variants" :min="1" :max="8" :step="1" @input="ctl.setSetting('variants', $event)"></rs-number>
			<rs-number label="Tree density" :value="snap.settings.treeScale" :min="0" :max="3" :step="0.1" @input="ctl.setSetting('treeScale', $event)"></rs-number>
			<rs-number label="Max slope for lots" :value="snap.settings.lot.maxSlope" :min="0.05" :max="0.8" :step="0.01" @input="ctl.setSetting('lot.maxSlope', $event)"></rs-number>
			<rs-number label="Lot level blend" suffix="m" :value="snap.settings.conform.lotBlend" :min="0" :max="20" :step="0.5" @input="ctl.setSetting('conform.lotBlend', $event)"></rs-number>
			<rs-toggle label="Level ground under buildings" :value="snap.settings.conform.lots" @input="ctl.setSetting('conform.lots', $event)"></rs-toggle>
			<rs-toggle label="Show buildings" :value="snap.display.buildings" @input="ctl.setDisplay('buildings', $event)"></rs-toggle>
			<rs-toggle label="Show trees" :value="snap.display.trees" @input="ctl.setDisplay('trees', $event)"></rs-toggle>
		</rs-section>

		<rs-section v-show="tab === 'export'" title="Game ready">
			<rs-toggle label="Bake facades" :value="snap.settings.gameReady.bakeFacades" @input="ctl.setSetting('gameReady.bakeFacades', $event)"></rs-toggle>
			<p class="rs_hint">Baked walls become one quad each on a shared atlas. Off keeps one quad per window bay.</p>
			<rs-toggle label="Levels of detail" :value="snap.settings.gameReady.lods" @input="ctl.setSetting('gameReady.lods', $event)"></rs-toggle>
			<rs-toggle label="Preserve facade detail" :value="snap.settings.gameReady.preserveTextureDetail" @input="ctl.setSetting('gameReady.preserveTextureDetail', $event)"></rs-toggle>
			<p class="rs_hint">Preserve detail adds atlas pages rather than lowering resolution. Disable for one compact atlas. No mesh simplification is applied by this option.</p>
			<rs-select label="Building atlas" :value="String(snap.settings.gameReady.atlasSize)" :options="atlas" @input="ctl.setSetting('gameReady.atlasSize', Number($event))"></rs-select>
			<rs-number label="Facade detail" suffix="px/m" :value="snap.settings.gameReady.texelsPerMeter" :min="2" :max="48" :step="1" @input="ctl.setSetting('gameReady.texelsPerMeter', $event)"></rs-number>
			<rs-number label="Building meshes" suffix="max" :value="snap.settings.gameReady.prefabBudget" :min="4" :max="200" :step="1" @input="ctl.setSetting('gameReady.prefabBudget', $event)"></rs-number>
			<rs-toggle label="Chunked terrain textures" :value="snap.settings.terrainTextureMode === 'chunks'" @input="ctl.setSetting('terrainTextureMode', $event ? 'chunks' : 'single')"></rs-toggle>
			<p class="rs_hint">Chunked textures retain local detail. Resolution is per 32-cell chunk; single-map mode uses less memory. Baked textures use smooth filtering, editable in Texture Properties.</p>
			<rs-select label="Terrain texture" :value="String(snap.settings.terrainTexture)" :options="atlas" @input="ctl.setSetting('terrainTexture', Number($event))"></rs-select>
			<rs-select label="Collision" :value="snap.settings.gameReady.collision" :options="collision" @input="ctl.setSetting('gameReady.collision', $event)"></rs-select>
			<div class="rs_row">
				<button class="rs_primary" :disabled="!!snap.busy" @click="ctl.exportPackage()" title="Writes meshes, textures, a manifest and a Godot loader to a folder">Export game package…</button>
				<button :disabled="!!snap.busy" @click="ctl.analyse()">Analyse</button>
			</div>
			<div class="rs_row">
				<button :disabled="!!snap.busy" @click="ctl.bake()" title="Creates ordinary meshes in this project">Bake city to meshes</button>
				<button :disabled="!!snap.busy" @click="ctl.gameReadySelection()" title="Removes hidden faces, simplifies and adds LODs for the selected meshes">Make selection game ready</button>
			</div>
			<div v-if="snap.report" class="rs_stats">
				<div>{{snap.report.prefabs}} building meshes · {{snap.report.buildings}} buildings · {{snap.report.trees}} trees</div>
				<div>{{snap.report.atlasPages}} atlas page(s) · {{snap.report.atlasSize}} px at {{snap.report.texelsPerMeter}} px/m</div>
				<div>Per mesh set: {{snap.report.prefabTriangles.join(' / ')}} triangles (LOD 0 / 1 / 2)</div>
				<div>City at full detail: {{snap.report.cityTriangles.toLocaleString()}} triangles ({{snap.report.terrainTriangles.toLocaleString()}} terrain)</div>
				<p v-for="w in snap.report.warnings" class="rs_warn">{{w}}</p>
			</div>
		</rs-section>

		<rs-section v-show="tab === 'project'" title="City" :open="false">
			<rs-number label="Units per metre" :value="snap.settings.unitsPerMeter" :min="0.0625" :max="64" :step="0.0625" @input="ctl.setSetting('unitsPerMeter', $event)"></rs-number>
			<p class="rs_hint">Map is {{snap.extent}} m across. Raise units per metre if your roads were drawn in Blockbench pixels (16 per block).</p>
			<div class="rs_row"><button @click="ctl.remove()">Remove city from project</button></div>
		</rs-section>
	</template>
</div>`;

/** Builds the Vue component for the sidebar panel. The controller does the work; the template only calls it. */
export function buildCityPanel(ctl: CityController, onMounted: (instance: PanelInstance) => void): PanelParts {
	const component: ComponentDefinition = {
		components: { 'rs-section': Section, 'rs-number': NumberField, 'rs-select': SelectField, 'rs-toggle': ToggleField },
		data: (): Record<string, unknown> => ({
			snap: ctl.snapshot(),
			status: ctl.status,
			ctl,
            tab: 'roads',
            tabs: [{id:'roads',label:'Roads'},{id:'terrain',label:'Terrain'},{id:'districts',label:'Districts'},{id:'export',label:'Export'},{id:'project',label:'Project'}],
			create: { size: 129, cellSize: 6, preset: 'rolling', seed: 1, kind: 'city', island: false },
			regen: { preset: 'rolling', island: false },
			landscapeModes: LANDSCAPE_MODES,
			districtModes: DISTRICT_MODES,
			districts: ctl.districts,
			surfaces: ctl.surfaces,
			presetOptions: ctl.presets.map((p) => ({ value: p.id, label: p.label })),
			falloff: FALLOFF,
			shape: SHAPE,
			sizes: SIZES,
			atlas: ATLAS,
			collision: COLLISION,
			kinds: KINDS,
			islandShapes: ISLAND_SHAPES,
			hands: HANDS,
			paintModes: PAINT_MODES,
		}),
		methods: {
			kindHint: (kind: string): string => KIND_HINTS[kind] ?? '',
			profileOptions: (profiles: Array<{ id: string; name: string }>, none: string): Array<{ value: string; label: string }> => [{ value: '', label: none }, ...profiles.map((p) => ({ value: p.id, label: p.name }))],
			structureOptions: (items: Array<{ id: string; label: string }>): Array<{ value: string; label: string }> => [{ value: 'keep', label: 'Keep each road’s own' }, ...items.map((i) => ({ value: i.id, label: i.label }))],
			waterHex: (c: [number, number, number]): string => '#' + c.map((v: number): string => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join(''),
			setWaterColor: (hex: string): void => ctl.setSetting('water.color', [1, 3, 5].map((i: number): number => parseInt(hex.slice(i, i + 2), 16) / 255)),
		},
		template: TEMPLATE,
		mounted(this: unknown): void {
			onMounted(this as PanelInstance);
		},
	};
	return { css: CITY_PANEL_CSS, component: component as unknown as Record<string, unknown> };
}
