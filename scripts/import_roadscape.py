"""Development-only Roadscape 4.13.10 artwork importer. Never executes blend scripts.
Adapted for 3D Bench, 2026-10-28. Supplied source: Baptiste Mollicone / SLX.
"""
import bpy, sys, json, math, hashlib, base64
import numpy as np
from pathlib import Path
root=Path(__file__).resolve().parents[1]
source=Path(sys.argv[sys.argv.index('--')+1]).resolve()
out=root/'.local-assets/roadscape';out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
material_names=['Road','Road Wet','Support Snow','Trail Support Spring','Trail Support Snow','Sidewalk A','Sidewalk Curb 1','Gutters Regular','Gutters V-Ditch','Guardrail New','Guardrail Poles','Bridge Deck','Bridge Column','Bridge Rail','Tunnel Wall','Tunnel Wall Upper','Tunnel Black Ceiling ','Tunnel Barrier','Marking','Marking Yellow','Racing Curb Red','Racing Curb White','Terrain Spring','Terrain Snow']
object_names=['Guardrail Poles','Jersey Barrier Concrete Grey Middle','RSEA Env Streetlight','Reshiba Lamp','Jet Fan','Raised Pavement Marker','Bridge Pole Baked','RSEA Rock Small']
objects={}
def clip_uv(poly,axis,bound,keep_above):
 result=[]
 for a,b in zip(poly,poly[1:]+poly[:1]):
  inside_a=(a[1][axis]>=bound) if keep_above else (a[1][axis]<=bound)
  inside_b=(b[1][axis]>=bound) if keep_above else (b[1][axis]<=bound)
  if inside_a:result.append(a)
  if inside_a!=inside_b:
   t=(bound-a[1][axis])/(b[1][axis]-a[1][axis])
   result.append(([x+(y-x)*t for x,y in zip(a[0],b[0])],[x+(y-x)*t for x,y in zip(a[1],b[1])]))
 return result
def wrap_source_uvs(data):
 faces=[]
 for face in data['faces']:
  if all(0<=v<=1 for uv in face['uvs'] for v in uv):faces.append(face);continue
  original=[(data['positions'][i],uv) for i,uv in zip(face['indices'],face['uvs'])]
  for u in range(math.floor(min(v[1][0] for v in original)),math.floor(max(v[1][0] for v in original))+1):
   for v in range(math.floor(min(v[1][1] for v in original)),math.floor(max(v[1][1] for v in original))+1):
    poly=original
    for axis,bound,above in [(0,u,True),(0,u+1,False),(1,v,True),(1,v+1,False)]:poly=clip_uv(poly,axis,bound,above)
    if len(poly)<3:continue
    # Remove zero-area UV fragments at exact tile boundaries.
    area=sum(a[1][0]*b[1][1]-b[1][0]*a[1][1] for a,b in zip(poly,poly[1:]+poly[:1]))
    if abs(area)<1e-10:continue
    k=len(data['positions']);data['positions'].extend([p[0] for p in poly])
    for j in range(1,len(poly)-1):
     ids=[0,j,j+1]
     faces.append({'indices':[k+i for i in ids],'material':face['material'],'uvs':[[poly[i][1][0]-u,poly[i][1][1]-v] for i in ids]})
 data['faces']=faces
for name in object_names:
 src=bpy.data.objects.get(name)
 if not src:continue
 obj=src.copy();obj.data=src.data.copy();bpy.context.scene.collection.objects.link(obj);obj.hide_viewport=False;obj.hide_set(False)
 bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get();ev=obj.evaluated_get(dg);mesh=bpy.data.meshes.new_from_object(ev,preserve_all_data_layers=True,depsgraph=dg)
 if not len(mesh.polygons):continue
 # Triangulate n-gons only; preserve all original UV corners and material assignments.
 import bmesh
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.triangulate(bm,faces=[f for f in bm.faces if len(f.verts)>4]);bm.to_mesh(mesh);bm.free()
 mats=[m.name if m else 'Guardrail Poles' for m in mesh.materials]
 for n in mats:
  if n not in material_names:material_names.append(n)
 uv=mesh.uv_layers.active
 objects[name]={'positions':[[round(v.co.x,6),round(v.co.z,6),round(-v.co.y,6)] for v in mesh.vertices], 'faces':[{'indices':list(p.vertices),'material':mats[p.material_index] if mats else 'Guardrail Poles','uvs':[[round(uv.data[i].uv.x,6),round(1-uv.data[i].uv.y,6)] if uv else [0,0] for i in p.loop_indices]} for p in mesh.polygons]}
 wrap_source_uvs(objects[name])
 bpy.data.objects.remove(obj,do_unlink=True)
 print('EXTRACT',name,len(mesh.polygons),flush=True)
# Atlas: 256px source-color tiles with a 2px duplicated border.
size=256;grid=math.ceil(math.sqrt(len(material_names)));atlas=np.ones((grid*size,grid*size,4),dtype=np.float32);materials={}
def image_for(mat):
 if not mat or not mat.use_nodes:return None
 # Trace the actual base-color branch instead of accidentally selecting normal maps.
 seen=set()
 def trace(socket):
  for link in socket.links:
   n=link.from_node
   if n.as_pointer() in seen:continue
   seen.add(n.as_pointer())
   if n.type=='TEX_IMAGE' and n.image:return n.image
   for s in n.inputs:
    found=trace(s)
    if found:return found
  return None
 for n in mat.node_tree.nodes:
  if n.type=='BSDF_PRINCIPLED':
   found=trace(n.inputs['Base Color'])
   if found:return found
 return None
for idx,name in enumerate(material_names):
 mat=bpy.data.materials.get(name);image=image_for(mat);tile=np.empty((size,size,4),dtype=np.float32)
 color=list(mat.diffuse_color) if mat else [.4,.4,.4,1]
 tile[:]=color
 if image:
  path=source.parent/'textures'/Path(image.filepath).name
  if path.exists(): image=bpy.data.images.load(str(path),check_existing=False)
  if image.size[0] and image.size[1]:
   # Copy before resizing so shared images and the source datablocks remain intact.
   copy=image.copy();copy.scale(size-4,size-4);pixels=np.array(copy.pixels[:],dtype=np.float32).reshape(size-4,size-4,4)
   tile=np.pad(pixels,((2,2),(2,2),(0,0)),mode='edge');bpy.data.images.remove(copy)
  else:raise RuntimeError('Missing source texture '+image.filepath)
 x=idx%grid;y=idx//grid;atlas[y*size:(y+1)*size,x*size:(x+1)*size]=tile
 # Atlas UVs use top-left origin, matching native editor texture coordinates.
 materials[name]={'tile':[(x*size+2)/(grid*size),1-((y+1)*size-2)/(grid*size),(size-4)/(grid*size)],'image':image.name if image else None}
img=bpy.data.images.new('Roadscape source colors',width=grid*size,height=grid*size,alpha=True);img.colorspace_settings.name='Non-Color';img.pixels.foreach_set(atlas.ravel());img.filepath_raw=str(out/'atlas.png');img.file_format='PNG';img.save()
result={'version':1,'sourceVersion':'4.13.10','sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'author':'Baptiste Mollicone and SLX','atlasSize':grid*size,'atlas':'data:image/png;base64,'+base64.b64encode((out/'atlas.png').read_bytes()).decode(),'materials':materials,'objects':objects}
(out/'library.json').write_text(json.dumps(result,separators=(',',':')))
print('EXPORTED',len(materials),'materials',len(objects),'objects',flush=True)
