/** A Godot 4 script that rebuilds an exported city from city.json. Statically typed throughout. */
export const GODOT_LOADER: string = `extends Node3D
class_name CityLoader
## Builds a city exported by the CityBuilder plugin.
## Copy the exported folder into your project, point \`city_dir\` at it and run the scene.

@export_dir var city_dir: String = "res://city"
## Preset name (for example "oak_realistic") -> PackedScene used for that kind of tree.
@export var tree_scenes: Dictionary = {}
## Distances at which buildings switch to their coarser meshes.
@export var lod_distances: PackedFloat32Array = PackedFloat32Array([90.0, 260.0])
@export var build_collision: bool = true

var _manifest: Dictionary = {}
var _meshes: Dictionary = {}
var _boxes: Dictionary = {}
var _building_materials: Dictionary = {}
var _building_material: StandardMaterial3D


func _ready() -> void:
	if not _load_manifest():
		return
	_building_material = _make_material(city_dir.path_join("buildings/atlas.png"))
	_build_terrain()
	_build_buildings()
	_build_trees()


func _load_manifest() -> bool:
	var path: String = city_dir.path_join("city.json")
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_error("CityLoader: %s was not found." % path)
		return false
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("CityLoader: city.json is not a valid city.")
		return false
	_manifest = parsed as Dictionary
	return true


func _make_material(texture_path: String) -> StandardMaterial3D:
	var material: StandardMaterial3D = StandardMaterial3D.new()
	material.albedo_texture = load(texture_path) as Texture2D
	material.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	material.roughness = 1.0
	return material


func _mesh(mesh_name: String) -> Mesh:
	if not _meshes.has(mesh_name):
		_meshes[mesh_name] = load(city_dir.path_join("buildings").path_join(mesh_name + ".obj")) as Mesh
	return _meshes[mesh_name] as Mesh


func _build_terrain() -> void:
	var terrain: Dictionary = _manifest["terrain"] as Dictionary
	var material: StandardMaterial3D = _make_material(city_dir.path_join(terrain["albedo"] as String))
	var chunks: Array = terrain["chunks"] as Array
	for index: int in range(chunks.size()):
		var node: MeshInstance3D = MeshInstance3D.new()
		node.mesh = load(city_dir.path_join(chunks[index] as String)) as Mesh
		var maps: Array = terrain.get("chunkAlbedos", []) as Array
		node.material_override = _make_material(city_dir.path_join(maps[index] as String)) if index < maps.size() else material
		add_child(node)
		if build_collision:
			node.create_trimesh_collision()


func _build_buildings() -> void:
	var prefabs: Dictionary = {}
	for prefab: Dictionary in _manifest["prefabs"] as Array:
		prefabs[prefab["id"]] = prefab
	for entry: Dictionary in _manifest["buildings"] as Array:
		var prefab: Dictionary = prefabs[entry["prefab"]] as Dictionary
		var root: Node3D = _make_building(prefab)
		var position_data: Array = entry["position"] as Array
		root.position = Vector3(position_data[0] as float, position_data[1] as float, position_data[2] as float)
		root.rotation.y = entry["yaw"] as float
		add_child(root)


func _make_building(prefab: Dictionary) -> Node3D:
	var root: Node3D = Node3D.new()
	var names: Array = prefab["meshes"] as Array
	var atlas_path: String = prefab.get("atlas", "buildings/atlas.png") as String
	if not _building_materials.has(atlas_path):
		_building_materials[atlas_path] = _make_material(city_dir.path_join(atlas_path))
	for index: int in range(names.size()):
		var instance: MeshInstance3D = MeshInstance3D.new()
		instance.mesh = _mesh(names[index] as String)
		instance.material_override = _building_materials[atlas_path] as StandardMaterial3D
		if index > 0:
			instance.visibility_range_begin = lod_distances[index - 1]
		if index < names.size() - 1:
			instance.visibility_range_end = lod_distances[index]
		root.add_child(instance)
	if build_collision:
		root.add_child(_make_collision(prefab))
	return root


func _make_collision(prefab: Dictionary) -> StaticBody3D:
	var body: StaticBody3D = StaticBody3D.new()
	for box: Dictionary in prefab["collision"] as Array:
		var size_data: Array = box["size"] as Array
		var center_data: Array = box["center"] as Array
		var size: Vector3 = Vector3(size_data[0] as float, size_data[1] as float, size_data[2] as float)
		var key: String = str(size)
		if not _boxes.has(key):
			var shape: BoxShape3D = BoxShape3D.new()
			shape.size = size
			_boxes[key] = shape
		var node: CollisionShape3D = CollisionShape3D.new()
		node.shape = _boxes[key] as BoxShape3D
		node.position = Vector3(center_data[0] as float, center_data[1] as float, center_data[2] as float)
		body.add_child(node)
	return body


func _build_trees() -> void:
	var assets: Dictionary = _manifest.get("treeAssets", {}) as Dictionary
	var materials: Dictionary = {}
	var meshes: Dictionary = {}
	for entry: Dictionary in _manifest["trees"] as Array:
		var node: Node3D
		var scene: PackedScene = tree_scenes.get(entry["preset"], null) as PackedScene
		if scene != null:
			node = scene.instantiate() as Node3D
		else:
			var key: String = entry.get("asset", "") as String
			if not assets.has(key):
				continue
			var asset: Dictionary = assets[key] as Dictionary
			if not meshes.has(key):
				meshes[key] = load(city_dir.path_join(asset["mesh"] as String)) as Mesh
				var material: StandardMaterial3D = _make_material(city_dir.path_join(asset["texture"] as String))
				material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
				material.alpha_scissor_threshold = 0.45
				material.cull_mode = BaseMaterial3D.CULL_DISABLED
				material.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
				materials[key] = material
			var instance: MeshInstance3D = MeshInstance3D.new()
			instance.mesh = meshes[key] as Mesh
			instance.material_override = materials[key] as StandardMaterial3D
			node = instance
		var position_data: Array = entry["position"] as Array
		node.position = Vector3(position_data[0] as float, position_data[1] as float, position_data[2] as float)
		node.rotation.y = entry["yaw"] as float
		node.scale = Vector3.ONE * (entry["scale"] as float)
		add_child(node)
`;
