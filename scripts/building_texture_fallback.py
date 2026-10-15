"""Bake a diffuse fallback for the source's reflective window material into its UV tiles.
Blender's metallic window shader depends on environment reflections. The plugin exports a
portable color texture, so preserve dark glazing instead of treating metallic base color as diffuse.
"""
import bpy
import numpy as np

def bake_window_fallback(library, path):
 image=bpy.data.images.load(str(path),check_existing=False)
 image.colorspace_settings.name='Non-Color' # Work in the PNG's stored sRGB byte values.
 width,height=image.size
 mask=np.zeros((height,width),dtype=bool)
 for module in library['modules'].values():
  for material,uv in zip(module['materials'],module['uvs']):
   if material!='Window':continue
   for i in range(1,len(uv)-1):
    a,b,c=[np.array(uv[k])*[width,height] for k in [0,i,i+1]]
    lo=np.maximum(0,np.floor(np.minimum(np.minimum(a,b),c)).astype(int));hi=np.minimum([width-1,height-1],np.ceil(np.maximum(np.maximum(a,b),c)).astype(int))
    xx,yy=np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5)
    edge=lambda p,q:(xx-p[0])*(q[1]-p[1])-(yy-p[1])*(q[0]-p[0])
    e1,e2,e3=edge(a,b),edge(b,c),edge(c,a)
    mask[lo[1]:hi[1]+1,lo[0]:hi[0]+1]|=((e1>=0)&(e2>=0)&(e3>=0))|((e1<=0)&(e2<=0)&(e3<=0))
 # Include the bake's four-pixel island padding without darkening adjacent materials.
 expanded=mask.copy()
 for delta in range(-4,5):expanded|=np.roll(mask,delta,axis=0)|np.roll(mask,delta,axis=1)
 pixels=np.empty(width*height*4,dtype=np.float32);image.pixels.foreach_get(pixels);pixels=pixels.reshape((height,width,4))
 grey=np.max(pixels[:,:,:3],axis=2)-np.min(pixels[:,:,:3],axis=2)<0.006
 source_grey=np.abs(pixels[:,:,0]-0.584)<0.03
 mask=expanded&grey&source_grey
 rgb=pixels[:,:,:3][mask]
 linear=np.where(rgb<=0.04045,rgb/12.92,((rgb+0.055)/1.055)**2.4)*0.16
 pixels[:,:,:3][mask]=np.where(linear<=0.0031308,linear*12.92,1.055*linear**(1/2.4)-0.055)
 image.pixels.foreach_set(pixels.ravel());image.filepath_raw=str(path);image.file_format='PNG';image.save()
 bpy.data.images.remove(image)
 return int(mask.sum())
