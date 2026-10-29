
import { createPreviewSkybox, PreviewSkybox } from "./preview_skyboxes";
import { CustomMenuItem } from "../interface/menu";
import { TransformerModule } from "../modeling/transform/transform_modules";
import { adjustFromAndToForInflateAndStretch } from "../outliner/types/cube";
import { compileJSON } from "../util/json";
import { toSnakeCase } from "../util/util";

export interface PreviewSceneOptions {
	name?: string
	description?: string
	category?: string
	light_color?: {r: number, g: number, b: number}
	light_side?: number
	condition?: ConditionResolvable
	cubemap?: string[]
	skybox?: PreviewSkybox
	fog?: {
		type: 'linear' | 'exponential'
		color
		near?: number
		far?: number
		density?: number
	}
	fov?: number
	preview_models?: (string | PreviewModel | PreviewModelOptions)[]
}

export class PreviewScene {
	id: string
	loaded: boolean = false;
	name: string;
	description?: string;
	category: string;
	light_color: {r: number, g: number, b: number} = {r: 1, g: 1, b: 1};
	light_side: number = 0;
	condition: ConditionResolvable;
	fov: number = null;
	fog?: THREE.Fog | THREE.FogExp2
	cubemap?: THREE.CubeTexture
	skybox?: PreviewSkybox
	preview_models: PreviewModel[] = [];

	constructor(id: string, data: PreviewSceneOptions = {}) {
		PreviewScene.scenes[id] = this;
		this.id = id;
		this.loaded = false;

		this.name = tl(data.name || `preview_scene.${id}`);
		this.category = data.category || 'generic';

		this.light_color = {r: 1, g: 1, b: 1};
		this.light_side = 0;
		this.condition;
		this.fov = null;

		this.preview_models = [];

		if (data) this.extend(data);

		PreviewScene.menu_categories[this.category][id] = this.name;
	}
	extend(data: PreviewSceneOptions) {
		this.loaded = true;

		this.name = tl(data.name || `preview_scene.${this.id}`);
		if (data.description) {
			this.description = tl(data.description);
		} else {
			this.description = tl('action.'+this.id+'.desc', [], '');
		}
		if (data.light_color) this.light_color = data.light_color;
		if (data.light_side) this.light_side = data.light_side;
		this.condition = data.condition;

		this.cubemap?.dispose();
		this.cubemap = null;
		this.skybox = data.skybox;
		if (data.cubemap) {
			let urls = data.cubemap;
			let texture_cube = new THREE.CubeTextureLoader().load(urls, () => {
				if (PreviewScene.active == this && Project.view_mode == 'material') {
					Canvas.updateShading();
				}
			});
			// @ts-expect-error
			texture_cube.colorSpace = THREE.SRGBColorSpace;
			texture_cube.mapping = THREE.CubeRefractionMapping;
			this.cubemap = texture_cube;
		}

		this.fog = null;
		if (data.fog) {
			if (data.fog.type == 'linear') {
				this.fog = new THREE.Fog(data.fog.color, data.fog.near, data.fog.far);
			} else {
				this.fog = new THREE.FogExp2(data.fog.color, data.fog.density);
			}
		}

		this.fov = null;
		if (data.fov) this.fov = data.fov;

		if (data.preview_models) {
			this.preview_models = data.preview_models.map(model => {
				if (typeof model == 'string') return PreviewModel.models[model];
				if (model instanceof PreviewModel == false && typeof model == 'object') {
					if (!model.name) model.name = this.name;
					model = new PreviewModel(model.id || this.id, model);
				}
				return model;
			}).filter(m => m instanceof PreviewModel);
		}
	}
	/**
	 * Selects this preview scene
	 */
	async select() {
		if (this.skybox && !this.cubemap) {
			this.cubemap = createPreviewSkybox(this.skybox);
		}
		if (PreviewScene.active) PreviewScene.active.unselect();

		if (this.fov) {
			Preview.selected.setFOV(this.fov);
		}
		// Update independent models
		PreviewModel.getActiveModels().forEach(model => {
			model.update();
		});
		PreviewScene.active = this;
		Blockbench.dispatchEvent('select_preview_scene', {scene: this});
		PreviewScene.updateVisibility();
	}
	/**
	 * Unselects this preview scene
	 */
	unselect() {
		this.preview_models.forEach(model => {
			model.disable();
		})

		if (this.fov) {
			Preview.all.forEach(preview => preview.setFOV(settings.fov.value as number));
		}
		Blockbench.dispatchEvent('unselect_preview_scene', {scene: this});
		PreviewScene.active = null;
		PreviewScene.updateVisibility();
	}
	static updateVisibility() {
		let scene = PreviewScene.active;
		let show = !!scene;
		scene?.preview_models.forEach(model => show ? model.enable() : model.disable());
		Canvas.global_light_color.set(0xffffff);
		Canvas.global_light_side = 0;
		Canvas.scene.background = null;
		Canvas.scene.fog = null;
		if (scene && show) {
			Canvas.global_light_color.copy(scene.light_color as THREE.Color);
			Canvas.global_light_side = scene.light_side;
			Canvas.scene.background = scene.cubemap;
			Canvas.scene.fog = scene.fog;
		}
		Canvas.updateShading();
	}
	delete() {
		if (PreviewScene.active == this) this.unselect();
		this.cubemap?.dispose();
		delete PreviewScene.scenes[this.id];
		delete PreviewScene.menu_categories[this.category][this.id];
	}

	/**
	 * All preview scenes, listed by ID
	 */
	static scenes: Record<string, PreviewScene> = {};
	/**
	 * The currently active scene
	 */
	static active: PreviewScene | null = null;
	static select_options = {};
	static menu_categories: {
		[category_id: string]: {
			[id: string]: string
		}
	} = {
		main: {
			none: tl('generic.none')
		},
		generic: {
			_label: 'Generic'
		},
		skybox: {
			_label: tl('preview_scene.skyboxes', [], 'Skyboxes')
		},
	};

}

StateMemory.init('preview_model_customization', 'object');

interface PreviewModelCubeTemplate {
	prefab?: string
	offset?: ArrayVector3
	offset_space?: 'block' | 'pixel'
	position?: ArrayVector3
	size?: ArrayVector3
	origin?: ArrayVector3
	rotation?: ArrayVector3
	faces?: {
		north?: { uv: ArrayVector4 }
		east?: { uv: ArrayVector4 }
		west?: { uv: ArrayVector4 }
		south?: { uv: ArrayVector4 }
		up?: { uv: ArrayVector4 }
		down?: { uv: ArrayVector4 }
	}
}
type PrefabTemplate = PreviewModelCubeTemplate
export interface PreviewModelOptions {
	id?: string
	name?: string
	internal?: boolean
	condition?: ConditionResolvable
	cubes?: PreviewModelCubeTemplate[]
	prefabs?: Record<string, PrefabTemplate>
	/**
	 * Source of the model's texture
	 */
	texture?: string
	/**
	 * Model tint color
	 */
	color?: string
	/**
	 * Enable shading on the material
	 */
	shading?: boolean
	/**
	 * THREE.JS material render side
	 */
	render_side?: number
	texture_size?: [number, number]
	position?: ArrayVector3
	rotation?: ArrayVector3
	scale?: ArrayVector3
	onUpdate?(): void
}
export class PreviewModel implements Deletable {
	id: string
	name: string
	internal: boolean = false;
	condition: ConditionResolvable
	model_3d: THREE.Object3D
	onUpdate?: () => void
	enabled: boolean = false;
	build_data: {
		prefabs?: Record<string, PrefabTemplate>,
		cubes?: PreviewModelCubeTemplate[],
		texture?: string
		position?: ArrayVector3
		rotation?: ArrayVector3
		scale?: ArrayVector3
	}
	color: string
	shading: boolean
	render_side: THREE.Side
	texture_size: ArrayVector2
	cubes: PreviewModelCubeTemplate[]
	texture?: string
	[idkey: string]: any

	constructor(id: string, data: PreviewModelOptions) {
		PreviewModel.models[id] = this;
		this.id = id;
		this.name = data.name ? tl(data.name) : '';
		this.internal = data.internal == true;
		this.condition = data.condition;
		this.model_3d = new THREE.Object3D();
		this.onUpdate = data.onUpdate;
		this.enabled = false;

		this.build_data = {
			prefabs: data.prefabs,
			cubes: data.cubes || [],
			texture: data.texture,
			position: data.position,
			rotation: data.rotation,
			scale: data.scale,
		}
		this.color = data.color || '#ffffff';
		this.shading = data.shading !== false;
		this.render_side = data.render_side == undefined ? THREE.DoubleSide : data.render_side;
		this.texture_size = data.texture_size || [16, 16];

		this.buildModel();
	}
	/**
	 * Enables the model in the preview
	 */
	enable() {
		Canvas.scene.add(this.model_3d);
		this.enabled = true;
		this.update();
	}
	/**
	 * Disables the model in the preview
	 */
	disable() {
		Canvas.scene.remove(this.model_3d);
		this.enabled = false;
	}
	/**
	 * Update the appearance and visibility of the model
	 */
	update() {
		let custom_data = StateMemory.preview_model_customization?.[this.id];

		if (custom_data?.position instanceof Array) {
			this.model_3d.position.fromArray(custom_data.position);
		} else {
			if (this.build_data.position) {
				this.model_3d.position.fromArray(this.build_data.position);
			} else {
				this.model_3d.position.set(0, 0, 0);
			}
			let offset = Format.centered_grid ? 0 : 8;
			this.model_3d.position.x += offset;
			this.model_3d.position.z += offset;
		}
		if (custom_data?.rotation instanceof Array) {
			this.model_3d.rotation.fromArray(custom_data.rotation.map((v: number) => Math.degToRad(v)));
		} else if (this.build_data.rotation) {
			this.model_3d.rotation.fromArray(this.build_data.rotation.map(v => Math.degToRad(v)));
		} else {
			this.model_3d.rotation.set(0, 0, 0);
		}
		if (custom_data?.scale instanceof Array) {
			this.model_3d.scale.fromArray(custom_data.scale);
		} else if (this.build_data.scale) {
			this.model_3d.scale.fromArray(this.build_data.scale);
		} else {
			this.model_3d.scale.set(1, 1, 1);
		}

		this.model_3d.visible = !!Condition(this.condition);

		if (typeof this.onUpdate == 'function') {
			this.onUpdate();
		}
	}
	buildModel() {
		let tex: THREE.Texture = undefined;
		if (this.build_data.texture) {
			let img = new Image();
			img.src = this.build_data.texture;
			tex = new THREE.Texture(img);
			tex.magFilter = THREE.NearestFilter;
			tex.minFilter = THREE.NearestFilter;
			tex.wrapS = THREE.RepeatWrapping;
			tex.wrapT = THREE.RepeatWrapping;
			img.crossOrigin = '';
			img.onload = function() {
				tex.needsUpdate = true;
			}
		}
		this.material = new (this.shading ? THREE.MeshLambertMaterial : THREE.MeshBasicMaterial)({
			color: this.color,
			map: tex,
			side: this.render_side,
			alphaTest: 0.05
		});
		if (typeof this.color == 'object') {
			this.material.color.copy(this.color);
		}

		if (this.build_data.position) this.model_3d.position.fromArray(this.build_data.position);
		if (this.build_data.rotation) this.model_3d.rotation.fromArray(this.build_data.rotation.map(r => Math.degToRad(r)));
		if (this.build_data.scale) this.model_3d.scale.fromArray(this.build_data.scale);

		this.build_data.cubes.forEach(cube => {
			if (cube.prefab) {
				if (!this.build_data.prefabs[cube.prefab]) console.error(`Invalid prefab "${cube.prefab}"`)
				cube = Object.assign(cube, this.build_data.prefabs[cube.prefab]);
				if (cube.offset) {
					if (cube.offset_space == 'block') cube.offset.V3_multiply(16);
					cube.position = cube.position.slice().V3_add(cube.offset);
					if (cube.origin) cube.origin = cube.origin.slice().V3_add(cube.offset);
				}
			}
			let mesh = new THREE.Mesh(new THREE.BoxGeometry(cube.size[0], cube.size[1], cube.size[2]), this.material)
			if (cube.origin) {
				mesh.position.set(cube.origin[0], cube.origin[1], cube.origin[2])
				mesh.geometry.translate(-cube.origin[0], -cube.origin[1], -cube.origin[2])
			}
			mesh.geometry.translate(cube.position[0] + cube.size[0]/2, cube.position[1] + cube.size[1]/2, cube.position[2] + cube.size[2]/2)
			if (cube.rotation) {
				// @ts-expect-error
				mesh.rotation.setFromDegreeArray(cube.rotation)
			}

			let getUVArray = (face) => {
				let arr = [
					[face.uv[0]/this.texture_size[0], 1-(face.uv[1]/this.texture_size[1])],
					[face.uv[2]/this.texture_size[0], 1-(face.uv[1]/this.texture_size[1])],
					[face.uv[0]/this.texture_size[0], 1-(face.uv[3]/this.texture_size[1])],
					[face.uv[2]/this.texture_size[0], 1-(face.uv[3]/this.texture_size[1])]
				]
				let rot = (face.rotation+0)
				while (rot > 0) {
					let a = arr[0];
					arr[0] = arr[2];
					arr[2] = arr[3];
					arr[3] = arr[1];
					arr[1] = a;
					rot = rot-90;
				}
				return arr;
			}

			let indices = [];
			// @ts-expect-error
			mesh.geometry.faces = [];
			mesh.geometry.clearGroups();
			Canvas.face_order.forEach((fkey, i) => {
				if (cube.faces[fkey]) {
					indices.push(0 + i*4, 2 + i*4, 1 + i*4, 2 + i*4, 3 + i*4, 1 + i*4);
					// @ts-expect-error
					mesh.geometry.faces.push(fkey)
				}
			})
			mesh.geometry.setIndex(indices);

			for (let face in cube.faces) {
				let uv_array = getUVArray(cube.faces[face]);
				let fIndex = 0;
				switch(face) {
					case 'north':   fIndex = 10;	break;
					case 'east':	fIndex = 0;		break;
					case 'south':   fIndex = 8;		break;
					case 'west':	fIndex = 2;		break;
					case 'up':		fIndex = 4;		break;
					case 'down':	fIndex = 6;		break;
				}
				let uv_attr = mesh.geometry.attributes.uv;
				(uv_attr.array as any).set(uv_array[0], fIndex*4 + 0);  //0,1
				(uv_attr.array as any).set(uv_array[1], fIndex*4 + 2);  //1,1
				(uv_attr.array as any).set(uv_array[2], fIndex*4 + 4);  //0,0
				(uv_attr.array as any).set(uv_array[3], fIndex*4 + 6);  //1,0
				uv_attr.needsUpdate = true;
			}

			this.model_3d.add(mesh);
		})
		return this;
	}
	delete() {
		delete PreviewModel.models[this.id];
	}

	static generateModelFromProject() {
		let cubes = Cube.all.map(cube => {
			let from = cube.from.slice() as ArrayVector3;
			let to = cube.to.slice() as ArrayVector3;
			adjustFromAndToForInflateAndStretch(from, to, cube);
			let data = {
				"position": from,
				"size": to.V3_subtract(from),
				"origin": undefined,
				"rotation": undefined,
				"faces": {}
			}
			if (cube.rotation.allEqual(0) == false) {
				data.rotation = cube.rotation.slice();
				data.origin = cube.origin.slice();
			}
			for (let fkey in cube.faces) {
				let face = cube.faces[fkey];
				if (face.texture == null) continue;
				data.faces[fkey] = new oneLiner({
					uv: face.uv.slice()
				})
			}
			return data;
		});
		let texture = Texture.getDefault();
		let texture_size = [
			Project.getUVWidth(texture),
			Project.getUVHeight(texture),
		]
		return compileJSON({
			texture_size,
			cubes
		});
	}
	static models: Record<string, PreviewModel> = {};
	static getActiveModels = function(): PreviewModel[] {
		let list = [];
		for (let id in PreviewModel.models) {
			let model = PreviewModel.models[id];
			if (model.enabled) {
				list.push(model);
			}
		}
		return list;
	}
	static transform_model: PreviewModel | null = null;
}

// Built-in skyboxes are generated on demand and available without network access.
for (const preset of [
	{id: 'neutral', name: 'Neutral Gray', light_color: {r: 1, g: 1, b: 1}},
	{id: 'clear_sky', name: 'Clear Sky', light_color: {r: 1, g: 1.02, b: 1.08}},
	{id: 'overcast', name: 'Overcast', light_color: {r: 0.96, g: 0.99, b: 1.04}},
	{id: 'sunset', name: 'Sunset', light_color: {r: 1.12, g: 0.94, b: 0.82}},
	{id: 'night', name: 'Night', light_color: {r: 0.72, g: 0.8, b: 1}},
]) {
	new PreviewScene(preset.id, {
		name: tl(`preview_scene.${preset.id}`, [], preset.name),
		category: 'skybox',
		skybox: preset.id as PreviewSkybox,
		light_color: preset.light_color,
	});
}
BARS.defineActions(function() {
	new Action('preview_scene', {
		category: 'view',
		icon: 'nature_people',
		click(event) {
			new Menu(this.children).show(event.target as HTMLElement);
		},
		children: () => {
			let list = [];
			for (let category in PreviewScene.menu_categories) {
				let options = PreviewScene.menu_categories[category];
				if (!Object.keys(options).some(key => !key.startsWith('_'))) continue;
				if (options._label) {
					list.push(new MenuSeparator('options_'+toSnakeCase(options._label), options._label));
				}
				for (let key in options) {
					if (key.startsWith('_')) continue;
					let scene = PreviewScene.scenes[key];
					list.push({
						id: key,
						name: options[key],
						icon: PreviewScene.active == scene ? 'far.fa-dot-circle' : 'far.fa-circle',
						click() {
							if (scene) {
								scene.select();
							} else if (PreviewScene.active) {
								PreviewScene.active.unselect();
							}
						}
					})
				}
			}
			return list;

		}
	})
	new Action('preview_models', {
		category: 'view',
		icon: 'park',
		click(event) {
			new Menu(this.children).show(event.target as HTMLElement);
		},
		children: () => {
			let list = [];
			for (let id in PreviewModel.models) {
				let model = PreviewModel.models[id];
				if (model.internal) continue;
				list.push({
					name: (model.name || id),
					icon: model.enabled ? 'check_box' : 'check_box_outline_blank',
					click() {
						if (!model.enabled) {
							model.enable();
							PreviewModel.transform_model = model;
							Transformer.updateSelection();
						} else {
							model.disable();
						}
					},
					children: model.enabled == false ? undefined : [
						{
							name: 'preview_model.transform',
							icon: 'control_camera',
							click() {
								PreviewModel.transform_model = model;
								Transformer.updateSelection();
							}
						},
						{
							name: 'preview_model.reset_transform',
							icon: 'reset_settings',
							click() {
								delete StateMemory.preview_model_customization[model.id];
								StateMemory.save('preview_model_customization');
								model.update();
							}

						}
					] as CustomMenuItem[]
				})
			}
			return list;

		}
	})
})

new TransformerModule('preview_model', {
	priority: 3,
	condition: () => PreviewModel.transform_model != undefined,
	updateGizmo() {
		let model = PreviewModel.transform_model;
		let channel = Toolbox.selected.animation_channel;

		model.model_3d.getWorldPosition(Transformer.position);
		Transformer.position.sub(Canvas.scene.position);
		let local = channel != 'position';
		Transformer.rotation_ref = local ? model.model_3d : Canvas.scene;
		return true;
	},
	calculateOffset(context) {
		let {point, axis, angle, event} = context;
		let channel = Toolbox.selected.animation_channel
		let value = point[axis];
		if (axis == 'e' && channel == 'scale') value = point.length();
		let interval = 1;
		
		if (channel == 'rotation') {
			value = angle;
			interval = getRotationInterval(event)
		} else if (channel == 'position') {
			interval = getSpatialInterval(context.event);
			
		} else if (channel == 'scale') {
			value *= context.direction * 0.1;
			interval = getSpatialInterval(context.event);
			interval *= 0.1;
		}
		value = Math.round(value/interval)*interval;

		return value;
	},
	onMove(context) {
		let {axis, second_axis, value} = context;
		let model = PreviewModel.transform_model;
		let channel = Toolbox.selected.animation_channel

		let difference = value - (this.previous_value||0);

		let data = StateMemory.preview_model_customization;
		let model_data = data[model.id];
		if (!model_data) model_data = data[model.id] = {};

		if (channel == 'position') {
			model.model_3d.position[axis] += difference;
			model_data.position = model.model_3d.position.toArray();
		} else if (channel == 'rotation') {
			model.model_3d.rotation[axis] += Math.degToRad(difference);
			model_data.rotation = [
				Math.radToDeg(model.model_3d.rotation.x),
				Math.radToDeg(model.model_3d.rotation.y),
				Math.radToDeg(model.model_3d.rotation.z),
			];
		} else {
			if (axis == 'e') {
				model.model_3d.scale.x += difference;
				model.model_3d.scale.y += difference;
				model.model_3d.scale.z += difference;
			} else {
				model.model_3d.scale[axis] += difference;
				if (second_axis) {
					model.model_3d.scale[second_axis] += difference;
				}
			}
			model_data.scale = model.model_3d.scale.toArray();
		}

		Blockbench.setCursorTooltip(trimFloatNumber(value - this.initial_value));
		Transformer.center()

	},
	onEnd(context) {
		StateMemory.save('preview_model_customization');
	},
});

const global = {
	PreviewScene,
	PreviewModel
};
declare global {
	type PreviewScene = import('./preview_scenes').PreviewScene
	const PreviewScene: typeof global.PreviewScene
	type PreviewModel = import('./preview_scenes').PreviewModel
	const PreviewModel: typeof global.PreviewModel
}
Object.assign(window, global);
