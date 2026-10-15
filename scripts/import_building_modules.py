"""Adapt the user's Blender building kit into local meshes and a baked color atlas.
Run with Blender --background --factory-startup --disable-autoexec --python this.py -- asset.blend
"""
import bpy, math, json, os, sys, hashlib, base64
from pathlib import Path
from mathutils import Vector
root=Path(__file__).resolve().parents[1]
args=sys.argv[sys.argv.index('--')+1:]
source=Path(args[0]).resolve()
bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
out=root/'.local-assets/buildings';out.mkdir(parents=True,exist_ok=True)
def socket_value(mod,key):
 if hasattr(mod,'properties'):return getattr(mod.properties.inputs,key).value
 return mod[key]
dg=bpy.context.evaluated_depsgraph_get()
sources=sorted([o for o in bpy.data.objects if o.type=='MESH' and o.name.startswith(('B1 ','B2 ','B3 '))],key=lambda o:o.name)
source_by_data={o.data.name:o.name for o in sources}
library={'version':2,'source':{'author':'Felipe Del Rio','file':source.name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'url':'https://felipedelrio.gumroad.com/l/msJMr'},'styles':{},'modules':{}}
for num in range(1,4):
 obj=bpy.data.objects[f'Building {num}'];m=obj.modifiers[0]
 library['styles'][f'b{num}']={'name':f'Building {num}','prefix':f'B{num}','module':socket_value(m,'Input_41'),'ground':socket_value(m,'Input_42'),'floor':socket_value(m,'Input_43'),'divider':socket_value(m,'Input_44'),'defaults':{k:socket_value(m,s) for k,s in [('bays_x','Input_2'),('bays_z','Input_3'),('floors','Input_4'),('top_floors','Input_5'),('seed','Input_23')]},'extras':[]}
 for collection,amount,seed,normal,top in [('Input_21','Input_22','Input_23','Input_24','Input_25'),('Input_26','Input_27','Input_28','Input_29','Input_30'),('Input_31','Input_33','Input_34','Input_35','Input_36'),('Input_32','Input_37','Input_38','Input_39','Input_40')]:
  library['styles'][f'b{num}']['extras'].append({'modules':[o.name for o in socket_value(m,collection).objects],'amount':socket_value(m,amount),'seed':socket_value(m,seed),'normal':socket_value(m,normal),'top':socket_value(m,top)})
# Independent ground truth from the live Geometry Nodes graph, before modifying the scene.
fixture={}
for inst in dg.object_instances:
 if not inst.is_instance or not inst.parent or inst.parent.original.name not in ['Building 1','Building 2','Building 3']:continue
 parent=inst.parent.original
 if inst.object.original.name!=parent.name:continue # Extras deliberately use a portable JS RNG.
 name=source_by_data.get(inst.object.data.name)
 if not name:raise RuntimeError('Unrecognized module '+inst.object.data.name)
 transform=parent.matrix_world.inverted()@inst.matrix_world
 fixture.setdefault(parent.name,[]).append({'module':name,'matrix':[[round(v,6) for v in row] for row in transform]})
json.dump(fixture,open(root/'tests/fixtures/buildings_placements.json','w'),separators=(',',':'))
# Apply source modifiers before UV packing, retaining split edges and smooth corner normals.
clones=[]
for index,source_obj in enumerate(sources):
 mesh=bpy.data.meshes.new_from_object(source_obj.evaluated_get(dg),depsgraph=dg)
 obj=bpy.data.objects.new('Bake '+source_obj.name,mesh);bpy.context.scene.collection.objects.link(obj)
 offset=Vector(((index%8)*30,(index//8)*30,0))
 obj.matrix_world=source_obj.matrix_world.copy();obj.location+=offset
 texture_space=bpy.data.objects.new('Texture space '+source_obj.name,None);bpy.context.scene.collection.objects.link(texture_space);texture_space.location=offset
 for slot in obj.material_slots:
  if not slot.material:continue
  slot.material=slot.material.copy()
  for node in slot.material.node_tree.nodes:
   if node.type=='TEX_COORD' and node.object:node.object=texture_space
 clones.append((source_obj.name,obj))
for obj in list(bpy.context.scene.objects):
 if obj not in [o for _,o in clones]:
  obj.hide_render=True
  if obj.name in bpy.context.view_layer.objects:obj.hide_set(True)
# Each source module owns one tile; repeated instances share its detailed material UVs.
atlas=bpy.data.images.new('Building material atlas',width=4096,height=4096,alpha=False)
atlas.generated_color=(0.08,0.08,0.08,1)
for index,(name,obj) in enumerate(clones):
 bpy.ops.object.select_all(action='DESELECT');obj.hide_set(False);obj.select_set(True);bpy.context.view_layer.objects.active=obj
 if not obj.data.uv_layers:obj.data.uv_layers.new(name='BuildingAtlas')
 obj.data.uv_layers.active_index=0
 bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
 bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=0.015,area_weight=0.5)
 bpy.ops.object.mode_set(mode='OBJECT')
 tilex=index%8;tiley=index//8
 for uv in obj.data.uv_layers.active.data:
  uv.uv=((tilex+0.02+uv.uv.x*0.96)/8,(tiley+0.02+uv.uv.y*0.96)/8)
 for slot in obj.material_slots:
  mat=slot.material
  if not mat:continue
  nodes=mat.node_tree.nodes;links=mat.node_tree.links
  bsdf=next((n for n in nodes if n.type=='BSDF_PRINCIPLED'),None)
  output=next(n for n in nodes if n.type=='OUTPUT_MATERIAL')
  emission=nodes.new('ShaderNodeEmission')
  if bsdf and bsdf.inputs['Base Color'].is_linked:links.new(bsdf.inputs['Base Color'].links[0].from_socket,emission.inputs['Color'])
  elif bsdf:emission.inputs['Color'].default_value=bsdf.inputs['Base Color'].default_value
  else:emission.inputs['Color'].default_value=mat.diffuse_color
  links.new(emission.outputs[0],output.inputs['Surface'])
  image=nodes.new('ShaderNodeTexImage');image.image=atlas;nodes.active=image
 print('PREPARED',index+1,name,flush=True)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16
scene.render.bake.use_clear=True;scene.render.bake.margin=4;scene.render.bake.use_selected_to_active=False
bpy.ops.object.select_all(action='DESELECT')
for _,obj in clones:obj.select_set(True)
bpy.context.view_layer.objects.active=clones[0][1]
bpy.ops.object.bake(type='EMIT')
atlas.filepath_raw=str(out/'atlas.png');atlas.file_format='PNG';atlas.save()
for name,obj in clones:
 mesh=obj.data
 mesh.calc_loop_triangles()
 # Triangulate only n-gons; retain the original editable quads and their loop UVs.
 triangles={}
 for tri in mesh.loop_triangles:triangles.setdefault(tri.polygon_index,[]).append(list(tri.loops))
 faces=[];uvs=[];normals=[];materials=[]
 for poly in mesh.polygons:
  loops=[list(poly.loop_indices)] if len(poly.vertices)<=4 else triangles[poly.index]
  for indices in loops:
   faces.append([mesh.loops[i].vertex_index for i in indices])
   uvs.append([[round(v,7) for v in mesh.uv_layers.active.data[i].uv] for i in indices])
   normals.append([[round(v,6) for v in mesh.corner_normals[i].vector] for i in indices])
   materials.append(obj.material_slots[poly.material_index].material.name.rsplit('.',1)[0])
 library['modules'][name]={'vertices':[[round(v,6) for v in vert.co] for vert in mesh.vertices],'faces':faces,'uvs':uvs,'normals':normals,'materials':materials}
sys.path.insert(0,str(root/'scripts'))
from building_texture_fallback import bake_window_fallback
print('WINDOW FALLBACK PIXELS',bake_window_fallback(library,out/'atlas.png'),flush=True)
library['atlas']={'width':4096,'height':4096,'data':'data:image/png;base64,'+base64.b64encode((out/'atlas.png').read_bytes()).decode()}
json.dump(library,open(out/'library.json','w'),separators=(',',':'))
print('EXPORTED',len(library['modules']),'modules to',out,flush=True)
