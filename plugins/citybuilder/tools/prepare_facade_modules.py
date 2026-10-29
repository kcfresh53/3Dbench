"""Extract selected regular facade meshes from the local FlexiBuilding extraction, without executing blend scripts."""
import json,sys,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[3]
source=Path(sys.argv[1]);out={}
for style in [1,7,10]:
 data=json.loads((root/f'.local-assets/flexibuilding/native/style{style}.json').read_text())
 for level in ['GF','Floor']:
  m=data['modules'][f'M.B{style}.{level}.Regular']
  out[f'{style}_{level}']={'bay':data['sizes'][0],'height':data['sizes'][2 if level=='GF' else 1],
   'vertices':m['vertices'],'faces':m['faces'],'normals':m['normals'],'materials':m['materials']}
(root/'plugins/citybuilder/assets/facade_modules.json').write_text(json.dumps(out,separators=(',',':')))
(root/'plugins/citybuilder/assets/facade_sources.json').write_text(json.dumps({'source':source.name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'modules':list(out),'note':'Selected source meshes; source material classes mapped to the city PBR materials. Source images are in the surface library.'},indent=2))
print('Extracted',len(out),'facade modules')
