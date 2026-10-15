"""Development-only extraction. The shipped plugin has no Blender dependency."""
import bpy,json,sys,math,hashlib,base64
from pathlib import Path
from mathutils import Matrix
root=Path(__file__).resolve().parents[1];out=root/'.local-assets/flexibuilding/native';out.mkdir(parents=True,exist_ok=True)
source=Path(sys.argv[sys.argv.index('--')+1]);style=int(sys.argv[sys.argv.index('--')+2])
bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
G=bpy.data.node_groups['Flexi Building Generator'];meshes={};presets={}
def put(name,mesh):
 if name not in meshes and len(mesh.polygons):meshes[name]=mesh.copy()
 return name
# Preserve exact placements of all five original envelopes.
for variant in range(1,6):
 src=bpy.data.objects[f'Building_{style}-{variant}'];obj=src.copy();obj.data=src.data.copy();bpy.context.scene.collection.objects.link(obj);obj.hide_viewport=False;obj.hide_set(False);obj.location=(0,0,0);obj.rotation_euler=(0,0,0);obj.scale=(1,1,1)
 modifier=obj.modifiers[0];getattr(modifier.properties.inputs,'Socket_18').value=False;obj.update_tag();bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get();placements=[]
 for inst in dg.object_instances:
  if not inst.parent or inst.parent.original!=obj or inst.object.type!='MESH':continue
  mesh=inst.object.data;name=mesh.name
  if not mesh.polygons:continue
  if not name.startswith(('M.','M-Plain.')) and name not in bpy.data.objects:
   digest=hashlib.sha1(str([(tuple(v.co)) for v in mesh.vertices]).encode()).hexdigest()[:10];name='Generated '+digest
  put(name,mesh);placements.append({'module':name,'transform':[round(v,6) for row in inst.matrix_world for v in row]})
 base=bpy.data.meshes.new_from_object(obj.evaluated_get(dg),preserve_all_data_layers=True,depsgraph=dg)
 if len(base.polygons):
  name=f'Generated base {variant}';put(name,base);placements.append({'module':name,'transform':[v for row in Matrix.Identity(4) for v in row]})
 presets[src.name]={'instances':placements}
 bpy.data.objects.remove(obj,do_unlink=True)
# Include all concave/plain variants even when a particular example does not use them.
dg=bpy.context.evaluated_depsgraph_get()
for obj in list(bpy.data.collections[f'FlexiBLD_ModulesBuilding{style:02}'].objects)+list(bpy.data.collections['FlexiBLD_Elements'].objects):
 clone=obj.copy();bpy.context.scene.collection.objects.link(clone);clone.hide_viewport=False;clone.hide_set(False);bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
 mesh=bpy.data.meshes.new_from_object(clone.evaluated_get(dg),preserve_all_data_layers=True,depsgraph=dg);put(obj.name,mesh);bpy.data.objects.remove(clone,do_unlink=True)
# A reusable source fire-escape section at this style's native proportions.
sizes=[(4,3.5,5.5),(3,3.5,4),(6,4,8.7),(7,3.5,6),(5,4,8),(5.5,4,10.6),(8,5,11),(5.5,4.5,8),(2.5,3.8,4.5),(8,4,9.8)];bay,floor,ground=sizes[style-1]
for output in ['Middle Stair','Last Stair','Geometry']:
 tree=bpy.data.node_groups.new('Extract stairs','GeometryNodeTree');tree.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry');n=tree.nodes.new('GeometryNodeGroup');n.node_tree=bpy.data.node_groups['.FlexiBLD_StairsGenerator'];n.inputs['Length'].default_value=bay;n.inputs['Height'].default_value=floor;n.inputs['Depth'].default_value=1.5
 result=tree.nodes.new('NodeGroupOutput');tree.links.new(n.outputs[output],result.inputs[0]);obj=bpy.data.objects.new('Stair extract',bpy.data.meshes.new('empty'));bpy.context.scene.collection.objects.link(obj);m=obj.modifiers.new('Extract','NODES');m.node_group=tree;bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get();mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(dg),preserve_all_data_layers=True,depsgraph=dg)
 if mesh.polygons:put('Stairs '+output,mesh)
 bpy.data.objects.remove(obj,do_unlink=True)
print('EXTRACTED',style,len(meshes),'modules',flush=True)
# Prepare a reusable UV tile per module. Source UV layers remain available to shaders.
clones=[];grid=math.ceil(math.sqrt(len(meshes)));tile=1/grid
for index,(name,mesh) in enumerate(sorted(meshes.items())):
 print('PREPARE',name,len(mesh.polygons),flush=True);obj=bpy.data.objects.new('Bake '+name,mesh);bpy.context.scene.collection.objects.link(obj);obj.location=((index%grid)*40,(index//grid)*40,0)
 # Colors is evaluated by the original palette graph on the original ColorMap attribute.
 tree=bpy.data.node_groups.new('Palette '+name,'GeometryNodeTree');tree.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry');tree.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry');i=tree.nodes.new('NodeGroupInput');o=tree.nodes.new('NodeGroupOutput');p=tree.nodes.new('GeometryNodeGroup');p.node_tree=bpy.data.node_groups['.FlexiBLD_Colors'];p.inputs['Building style'].default_value=style-1;p.inputs['Building palette'].default_value=0;tree.links.new(i.outputs[0],p.inputs['Geometry']);tree.links.new(p.outputs[0],o.inputs[0]);mod=obj.modifiers.new('Palette','NODES');mod.node_group=tree
 # Freeze implicit UV readers before changing the active layer.
 old_uv=(mesh.uv_layers.active or mesh.uv_layers.get('UVMap') or mesh.uv_layers[0]).name if mesh.uv_layers else 'UVMap'
 for slot in obj.material_slots:
  if slot.material:
   slot.material=slot.material.copy()
   nodes=slot.material.node_tree.nodes;links=slot.material.node_tree.links
   for node in list(nodes):
    if node.type=='TEX_COORD':
     uv=nodes.new('ShaderNodeUVMap');uv.uv_map=old_uv
     for link in list(node.outputs['UV'].links):links.new(uv.outputs[0],link.to_socket)
    if node.type=='TEX_IMAGE' and not node.inputs['Vector'].is_linked:
     uv=nodes.new('ShaderNodeUVMap');uv.uv_map=old_uv;links.new(uv.outputs[0],node.inputs['Vector'])
 # Neutral source lighting attributes for baked interior imagery.
 for attr_name,kind,value in [('Windows_Attribute1','FLOAT_VECTOR',(0,1,4500)),('Windows_Attribute2','FLOAT_VECTOR',(0,0,0)),('Windows_AttributeRandom','INT',index+1),('Is instance','BOOLEAN',False)]:
  attr=mesh.attributes.get(attr_name)
  if attr:mesh.attributes.remove(attr)
  attr=mesh.attributes.new(attr_name,kind,'POINT')
  for v in attr.data:
   if kind=='FLOAT_VECTOR':v.vector=value
   else:v.value=value
 bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj;bpy.context.view_layer.update()
 mesh.uv_layers.new(name='BenchAtlas');mesh.uv_layers.active_index=len(mesh.uv_layers)-1;mesh.uv_layers.active.active_render=True
 bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.015,area_weight=.5);bpy.ops.object.mode_set(mode='OBJECT')
 for uv in mesh.uv_layers.active.data:uv.uv=((index%grid+.025+uv.uv.x*.95)*tile,(index//grid+.025+uv.uv.y*.95)*tile)
 clones.append((name,obj,p))
# Bake diffuse surface color and the creator's interior emission branch.
seen=set()
def prepare(tree):
 if tree.as_pointer() in seen:return
 seen.add(tree.as_pointer())
 for n in list(tree.nodes):
  if n.type=='GROUP' and n.node_tree:prepare(n.node_tree)
  if n.type=='BSDF_PRINCIPLED' or n.bl_idname=='ShaderNodeBsdfAnisotropic':
   emit=tree.nodes.new('ShaderNodeEmission');base=n.inputs.get('Base Color') or n.inputs.get('Color')
   if base and base.is_linked:tree.links.new(base.links[0].from_socket,emit.inputs['Color'])
   elif n.type=='BSDF_PRINCIPLED':emit.inputs['Color'].default_value=base.default_value
   else:emit.inputs['Color'].default_value=(.035,.055,.07,1)
   for link in list(n.outputs[0].links):tree.links.new(emit.outputs[0],link.to_socket)
for name,obj,p in clones:
 for mat in obj.data.materials:
  if not mat:continue
  prepare(mat.node_tree)
  if mat.name.startswith('FlexiBLD_Parallax'):
   node=next(n for n in mat.node_tree.nodes if n.type=='GROUP' and 'Emit' in n.outputs);output=next(n for n in mat.node_tree.nodes if n.type=='OUTPUT_MATERIAL');mat.node_tree.links.new(node.outputs['Emit'],output.inputs['Surface'])
for obj in list(bpy.context.scene.objects):
 if obj not in [o for _,o,_ in clones]:
  obj.hide_render=True
  if obj.name in bpy.context.view_layer.objects:obj.hide_set(True)
size=2048;atlas=bpy.data.images.new('Atlas',width=size,height=size,alpha=False)
for name,obj,p in clones:
 for mat in obj.data.materials:
  if not mat:continue
  n=mat.node_tree.nodes.new('ShaderNodeTexImage');n.image=atlas;mat.node_tree.nodes.active=n
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=8;scene.render.bake.margin=2;scene.render.bake.use_clear=True;scene.render.bake.use_selected_to_active=False
bpy.ops.object.select_all(action='DESELECT')
for _,obj,_ in clones:obj.hide_set(False);obj.select_set(True)
bpy.context.view_layer.objects.active=clones[0][1]
# Record exact creator palette colors without duplicating five full texture maps.
palettes=[]
for palette in range(5):
 colors={}
 for name,obj,p in clones:
  p.inputs['Building palette'].default_value=palette;obj.update_tag()
 bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
 for name,obj,p in clones:
  evaluated=bpy.data.meshes.new_from_object(obj.evaluated_get(dg),preserve_all_data_layers=True,depsgraph=dg)
  mapping=evaluated.attributes.get('ColorMap');colored=evaluated.attributes.get('Colors')
  if mapping and colored:
   for i,value in enumerate(mapping.data):colors[str(round(value.color[0],4))]=[round(v,6) for v in colored.data[i].color[:3]]
  bpy.data.meshes.remove(evaluated)
 palettes.append(colors)
atlases=[]
for palette in range(1):
 for name,obj,p in clones:p.inputs['Building palette'].default_value=palette;obj.update_tag()
 bpy.context.view_layer.update()
 if not (out/f'style{style}-palette1.png').exists():
  # Bake one joined evaluated object, avoiding a separate Cycles setup per module.
  dg=bpy.context.evaluated_depsgraph_get();copies=[]
  bpy.ops.object.select_all(action='DESELECT')
  for name,obj,p in clones:
   me=bpy.data.meshes.new_from_object(obj.evaluated_get(dg),preserve_all_data_layers=True,depsgraph=dg)
   copy=bpy.data.objects.new('Atlas bake',me);bpy.context.scene.collection.objects.link(copy);copy.matrix_world=obj.matrix_world.copy();copy.select_set(True);copies.append(copy);obj.hide_render=True
  bpy.context.view_layer.objects.active=copies[0];bpy.ops.object.join();bpy.ops.object.bake(type='EMIT',uv_layer='BenchAtlas')
  atlas.filepath_raw=str(out/f'style{style}-palette1.png');atlas.file_format='PNG';atlas.save()
 atlas.filepath_raw=str(out/f'style{style}-palette{palette+1}.png');atlas.file_format='PNG';atlases.append('data:image/png;base64,'+base64.b64encode(Path(atlas.filepath_raw).read_bytes()).decode());print('BAKED',style,palette+1,flush=True)
modules={}
for name,obj,p in clones:
 mesh=obj.data;mesh.calc_loop_triangles();tris={}
 for t in mesh.loop_triangles:tris.setdefault(t.polygon_index,[]).append(list(t.loops))
 faces=[];uvs=[];normals=[];materials=[];color_keys=[]
 for poly in mesh.polygons:
  for indices in ([list(poly.loop_indices)] if len(poly.vertices)<=4 else tris[poly.index]):
   faces.append([mesh.loops[i].vertex_index for i in indices]);uvs.append([[round(v,7) for v in mesh.uv_layers.active.data[i].uv] for i in indices]);normals.append([[round(v,6) for v in mesh.corner_normals[i].vector] for i in indices]);mat=obj.material_slots[poly.material_index].material;materials.append(mat.name.split('.')[0] if mat else '');color_map=mesh.attributes.get('ColorMap');color_keys.append(str(round(color_map.data[indices[0]].color[0],4)) if color_map else '')
 modules[name]={'vertices':[[round(v,6) for v in vert.co] for vert in mesh.vertices],'faces':faces,'uvs':uvs,'normals':normals,'materials':materials,'color_keys':color_keys}
library={'version':4,'style':style,'sizes':[bay,floor,ground],'modules':modules,'presets':presets,'atlases':atlases,'palettes':palettes,'atlas':{'width':size,'height':size}}
(out/f'style{style}.json').write_text(json.dumps(library,separators=(',',':')));print('FINISHED STYLE',style,flush=True)
