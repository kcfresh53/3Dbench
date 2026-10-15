"""Import a locally purchased SD Characters pack. Run with Blender, scripts disabled:
blender --background --factory-startup --disable-autoexec --python scripts/import_humanoid_templates.py -- /path/to/pack.zip
The commercial mesh data is written only to .local-assets (ignored by Git).
"""
import bpy
import sys
import json
import zipfile
import tempfile
from pathlib import Path

archive = Path(sys.argv[sys.argv.index('--') + 1]).expanduser().resolve()
out = Path(__file__).resolve().parent.parent / '.local-assets' / 'humanoid'
out.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(Path(__file__).resolve().parent))
from psd_composite import psd_to_png
from texture_atlas import make_atlas
from chibi_hand_rig import add_hand_controls
rename = {'thigh': 'upper_leg', 'shin': 'lower_leg', 'forearm': 'lower_arm'}
def bone_id(name):
    base, dot, side = name.partition('.')
    return rename.get(base, base) + (dot + side if dot else '')

with tempfile.TemporaryDirectory(prefix='3dbench-template-') as temporary, zipfile.ZipFile(archive) as pack:
    for sex in ['Male', 'Female']:
        entry = next(n for n in pack.namelist() if n.endswith(f'/SD-{sex} (Blender).blend'))
        source = Path(temporary) / f'{sex}.blend'
        source.write_bytes(pack.read(entry))
        bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
        obj = next(o for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith('.Body'))
        arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
        mesh = obj.data
        world = [obj.matrix_world @ v.co for v in mesh.vertices]
        floor = min(v.z for v in world)
        height = max(v.z for v in world) - floor
        def point(v):
            return [v.x / height * 32, (v.z - floor) / height * 32, v.y / height * 32]
        bones = []
        visited = set()
        def add_bone(b):
            if b.name in visited or b.name.startswith('IK.'):
                return
            if b.parent:
                add_bone(b.parent)
            visited.add(b.name)
            bones.append(dict(id=bone_id(b.name), parent=bone_id(b.parent.name) if b.parent else None,
                              head=point(arm.matrix_world @ b.head_local), tail=point(arm.matrix_world @ b.tail_local), connected=b.use_connect))
        for b in arm.data.bones:
            add_bone(b)
        ids = {b['id'] for b in bones}
        groups = {g.index: bone_id(g.name) for g in obj.vertex_groups}
        weights = [{groups[g.group]: g.weight for g in v.groups if groups[g.group] in ids and g.weight > 0} for v in mesh.vertices]
        add_hand_controls(sex, [point(v) for v in world], bones, weights)
        # Swapping Y and Z changes handedness, so reverse polygon and UV corner order together.
        mesh.calc_loop_triangles()
        faces, uv, materials = [], [], []
        for polygon in mesh.polygons:
            # The editor supports triangles/quads. Tessellate only the two source pentagons,
            # using Blender's triangulation, without moving or adding any vertex.
            loops = [polygon.loop_indices[:]] if len(polygon.vertices) <= 4 else [t.loops[:] for t in mesh.loop_triangles if t.polygon_index == polygon.index]
            for corners in loops:
                corners = list(reversed(corners))
                faces.append([mesh.loops[i].vertex_index for i in corners])
                uv.append([list(mesh.uv_layers.active.data[i].uv) for i in corners])
                materials.append(polygon.material_index)
        label = sex.lower()
        face_entry = next(n for n in pack.namelist() if n.endswith(f'/{sex}-Expression-01.png'))
        body_entry = next(n for n in pack.namelist() if n.endswith(f'/{sex}-Body-Underwear.psd'))
        atlas, remap = make_atlas(pack.read(face_entry), psd_to_png(pack.read(body_entry)))
        (out / f'{label}-chibi.png').write_bytes(atlas)
        uv = [[remap(corner, material) for corner in corners] for corners, material in zip(uv, materials)]
        materials = [0] * len(materials)
        for obsolete in [f'{label}-face.png', f'{label}-body.png']:
            (out / obsolete).unlink(missing_ok=True)
        template = dict(schema_version=1, name=f'{sex} Chibi base', height=32,
                        source='QUBITS — SD Characters Models Base Pack (local purchased copy)',
                        bones=bones, meshes=[dict(name=f'{sex} Chibi base', vertices=[point(v) for v in world],
                        faces=faces, vertex_weights=weights, face_uvs=uv, face_materials=materials)],
                        textures=[dict(name=f'{sex} Chibi base', file=f'{label}-chibi.png')])
        (out / f'chibi_{label}.json').write_text(json.dumps(template, separators=(',', ':')))
        print(f'Imported {sex}: {len(mesh.vertices)} vertices, {sum(len(p.vertices)-2 for p in mesh.polygons)} triangles, {len(bones)} bones')
