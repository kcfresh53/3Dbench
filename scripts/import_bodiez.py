"""Install user-supplied Bodiez meshes locally; never execute embedded Blender scripts.
blender --background --factory-startup --disable-autoexec --python scripts/import_bodiez.py -- /path/to/Bodiez-folder
"""
import json
import re
import sys
from pathlib import Path
import bpy

folder = Path(sys.argv[sys.argv.index('--') + 1]).expanduser().resolve()
output = Path(__file__).resolve().parent.parent / '.local-assets' / 'humanoid'
output.mkdir(parents=True, exist_ok=True)
SHAPES = ['Regular', 'Thin', 'Muscular', 'Fat', 'Hip_Wide', 'Breast_Small', 'Breast_Big']
SPINE = ['hips', 'spine', 'chest', 'upper_chest', 'neck_base', 'neck', 'head']

def canonical(name):
    name = name.removeprefix('DEF-')
    if name == 'Root':
        return 'root'
    if name == 'spine':
        return 'hips'
    if re.fullmatch(r'spine\.00[1-6]', name):
        return SPINE[int(name[-1])]
    name = re.sub(r'^f_(index|middle|ring|pinky)\.0([1-3])', r'\1_\2', name)
    name = re.sub(r'^thumb\.0([1-3])', r'thumb_\1', name)
    for old, new in [('thigh.', 'upper_leg.'), ('shin.', 'lower_leg.'), ('forearm.', 'lower_arm.'), ('toe.', 'toes.')]:
        if name.startswith(old):
            return new + name[len(old):]
    return name

for sex in ['male', 'female']:
    source = folder / f'modular_{sex}_base.blend'
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    body = next(o for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith('_Body'))
    objects = [body] + [o for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith('_Ear')]
    # Normalize against the Regular shape, which is the source driver's default body type.
    keys = body.data.shape_keys.key_blocks
    regular = [body.matrix_world @ (v.co + keys['Regular'].data[i].co - keys['Regular'].relative_key.data[i].co) for i, v in enumerate(body.data.vertices)]
    floor = min(v.z for v in regular)
    scale = 32 / (max(v.z for v in regular) - floor)
    def point(v):
        return [v.x * scale, (v.z - floor) * scale, v.y * scale]
    def delta(v):
        return [v.x * scale, v.z * scale, v.y * scale]
    selected = {b.name for b in arm.data.bones if b.use_deform} | {'Root'}
    bones, visited = [], set()
    def add_bone(b):
        if b.name in visited:
            return
        parent = b.parent
        while parent and parent.name not in selected:
            parent = parent.parent
        if parent:
            add_bone(parent)
        visited.add(b.name)
        bones.append(dict(id=canonical(b.name), parent=canonical(parent.name) if parent else None,
                          head=point(arm.matrix_world @ b.head_local), tail=point(arm.matrix_world @ b.tail_local), connected=b.use_connect and parent == b.parent))
    for b in arm.data.bones:
        if b.name in selected:
            add_bone(b)
    ids = {b['id'] for b in bones}
    meshes, morphs = [], []
    for obj in objects:
        mesh = obj.data
        groups = {g.index: canonical(g.name) for g in obj.vertex_groups}
        weights = []
        for v in mesh.vertices:
            influences = {groups[g.group]: g.weight for g in v.groups if groups[g.group] in ids and g.weight > 0}
            if not influences:
                if obj == body:
                    raise RuntimeError(f'Unweighted body vertex {v.index}')
                # The separate ears use a different source rig; attach to this rig's head.
                influences = {'head': 1}
            total = sum(influences.values())
            weights.append({k: w / total for k, w in influences.items()})
        mesh.calc_loop_triangles()
        faces, uvs = [], []
        for polygon in mesh.polygons:
            loops = [list(polygon.loop_indices)] if len(polygon.vertices) <= 4 else [list(t.loops) for t in mesh.loop_triangles if t.polygon_index == polygon.index]
            for corners in loops:
                corners.reverse()  # Y/Z swap reverses handedness; keep UV corners aligned.
                faces.append([mesh.loops[i].vertex_index for i in corners])
                uvs.append([list(mesh.uv_layers.active.data[i].uv) if mesh.uv_layers.active else [0, 0] for i in corners])
        meshes.append(dict(name='Body' if obj == body else 'Ears', vertices=[point(obj.matrix_world @ v.co) for v in mesh.vertices],
                           vertex_weights=weights, faces=faces, face_uvs=uvs, face_materials=[-1] * len(faces)))
        shapes = obj.data.shape_keys.key_blocks
        morphs.append({name: [delta(obj.matrix_world.to_3x3() @ (v.co - ref.co)) for v, ref in zip(shapes[name].data, shapes[name].relative_key.data)] for name in SHAPES if name in shapes})
    template = dict(schema_version=1, name=f'{sex.title()} base', source=f'Bodiez / {source.name} (local copy)', height=32,
                    bones=bones, meshes=meshes, textures=[], customization=dict(system='bodiez', sex=sex, morphs=morphs))
    target = output / f'bodiez_{sex}.json'
    target.write_text(json.dumps(template, separators=(',', ':')) + '\n')
    print(f'Installed {target}: {sum(len(m["vertices"]) for m in meshes)} vertices, {len(bones)} bones')
