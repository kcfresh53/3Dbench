"""Adapt the user-supplied low-poly male FBX for the Male base preset.
Run with Blender --background --factory-startup --disable-autoexec --python
scripts/import_male_base.py -- /path/to/low-poly-male-base-mesh.zip
Normalizes coordinates, fits an A-pose rig, generates heat weights, and preserves UVs.
"""
import bpy
import json
import sys
import tempfile
import zipfile
from pathlib import Path
from mathutils import Vector

archive = Path(sys.argv[sys.argv.index('--') + 1]).expanduser().resolve()
output = Path(__file__).resolve().parent.parent / 'assets' / 'humanoid' / 'male_base.json'
bpy.ops.wm.read_factory_settings(use_empty=True)
with tempfile.TemporaryDirectory(prefix='3dbench-male-') as directory:
    with zipfile.ZipFile(archive) as pack:
        source = Path(directory) / 'male.fbx'
        source.write_bytes(pack.read('source/lowpoly_male_base_mesh-TPOSE.fbx'))
    bpy.ops.import_scene.fbx(filepath=str(source))
obj = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
world = [obj.matrix_world @ v.co for v in obj.data.vertices]
floor = min(v.z for v in world)
height = max(v.z for v in world) - floor
# Keep Blender's right-handed coordinates while calculating heat weights.
for vertex, point in zip(obj.data.vertices, world):
    vertex.co = (point.x * 32 / height, point.y * 32 / height, (point.z - floor) * 32 / height)
obj.matrix_world.identity()
bones = []
def bone(name, parent, head, tail, connected=False):
    bones.append(dict(id=name, parent=parent, head=head, tail=tail, connected=connected))
bone('root', None, [0,0,0], [0,1,0])
bone('hips', 'root', [0,15.5,.4], [0,18,.4])
bone('spine', 'hips', [0,18,.4], [0,21.5,.4], True)
bone('chest', 'spine', [0,21.5,.4], [0,26,.6], True)
bone('neck', 'chest', [0,26,.6], [0,28,.3], True)
bone('head', 'neck', [0,28,.3], [0,31.7,.3], True)
for side, sign in [('L',1),('R',-1)]:
    def p(x,y,z): return [sign*x,y,z]
    def add(name, parent, a, b, connected=False):
        bone(name+'.'+side, parent if parent in ['hips','chest'] else parent+'.'+side, a, b, connected)
    add('upper_leg','hips',p(2.2,15.5,.4),p(3.5,8.2,.9))
    add('lower_leg','upper_leg',p(3.5,8.2,.9),p(4.85,1.9,1),True)
    add('foot','lower_leg',p(4.85,1.9,1),p(4.85,.7,-.7),True)
    add('toes','foot',p(4.85,.7,-.7),p(4.85,.5,-1.9),True)
    add('shoulder','chest',p(.5,25.8,.6),p(3.8,25.4,.8))
    add('upper_arm','shoulder',p(3.8,25.4,.8),p(6.3,21.1,.7),True)
    add('lower_arm','upper_arm',p(6.3,21.1,.7),p(9.05,17.4,0),True)
    add('hand','lower_arm',p(9.05,17.4,0),p(9.65,16.3,-.3),True)
    add('fingers','hand',p(9.65,16.3,-.3),p(10.5,14.95,-.6),True)
    add('thumb_1','hand',p(9.05,16.9,-.6),p(8.9,16.2,-.9))
    add('thumb_2','thumb_1',p(8.9,16.2,-.9),p(8.75,15.8,-.95),True)
arm_data = bpy.data.armatures.new('Male base')
arm = bpy.data.objects.new('Male base', arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for spec in bones:
    b = arm_data.edit_bones.new(spec['id'])
    b.head = (spec['head'][0],spec['head'][2],spec['head'][1])
    b.tail = (spec['tail'][0],spec['tail'][2],spec['tail'][1])
    if spec['parent']: b.parent = arm_data.edit_bones[spec['parent']]
    b.use_connect = spec['connected']
    b.use_deform = spec['id'] != 'root'
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
groups = {g.index:g.name for g in obj.vertex_groups}
weights = []
for v in obj.data.vertices:
    influences = sorted([(groups[g.group],g.weight) for g in v.groups if g.weight > 1e-5],key=lambda item:-item[1])[:4]
    if not influences: raise RuntimeError(f'Heat weighting failed at vertex {v.index}')
    total = sum(w for _,w in influences)
    weights.append({name:w/total for name,w in influences})
mesh = obj.data
mesh.calc_loop_triangles()
faces, uvs = [], []
for polygon in mesh.polygons:
    loops = [list(polygon.loop_indices)] if len(polygon.vertices)<=4 else [list(t.loops) for t in mesh.loop_triangles if t.polygon_index==polygon.index]
    for corners in loops:
        corners.reverse() # Y/Z swap reverses handedness.
        faces.append([mesh.loops[i].vertex_index for i in corners])
        uvs.append([list(mesh.uv_layers.active.data[i].uv) for i in corners])
template = dict(schema_version=1,name='Male base',source='low-poly-male-base-mesh.zip / source/lowpoly_male_base_mesh-TPOSE.fbx; fitted rig and normalized height',height=32,bones=bones,textures=[],meshes=[dict(name='Male base',vertices=[[v.co.x,v.co.z,v.co.y] for v in mesh.vertices],faces=faces,face_uvs=uvs,face_materials=[-1]*len(faces),vertex_weights=weights)])
output.parent.mkdir(parents=True,exist_ok=True)
output.write_text(json.dumps(template,separators=(',',':'))+'\n')
print(f'Adapted Male base: {len(mesh.vertices)} vertices, {len(faces)} faces, {len(bones)} bones → {output}')
