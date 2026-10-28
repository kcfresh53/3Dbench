"""Prepare portable terrain tiles and Roadscape cutouts. Usage: python prepare_city_textures.py ZIP_DIRECTORY ROADSCAPE_TEXTURE_DIRECTORY"""
from pathlib import Path
import sys, zipfile, io, json, base64
from PIL import Image
root = Path(__file__).resolve().parents[1] / 'plugins/citybuilder'
out = root / 'textures'
out.mkdir(exist_ok=True)
zipdir, trees = map(Path, sys.argv[1:3])
tiles = {}
for key, archive in [('forest','city-ground.zip'),('sand','city-soil.zip'),('dirt','city-loam.zip'),('grass','city-grass.zip'),('rock','city-rock.zip')]:
    with zipfile.ZipFile(zipdir / archive) as z:
        name = next(n for n in z.namelist() if n.endswith('_Color.jpg'))
        im = Image.open(io.BytesIO(z.read(name))).convert('RGB')
        im.save(out / (key + '.jpg'), quality=90)
        im = im.resize((256,256), Image.Resampling.LANCZOS)
        tiles[key] = base64.b64encode(im.tobytes()).decode()
(root / 'src/texture/terrain_tiles.json').write_text(json.dumps(tiles))
cutouts={}
for i in range(1,6):
    im=Image.open(trees / f'tree{i}.png').convert('RGBA')
    # Crop empty borders so the bottom of the cross-plane actually touches the ground.
    bounds=im.getchannel('A').point(lambda a: 255 if a > 12 else 0).getbbox()
    im=im.crop(bounds); aspect=im.width/im.height
    im.thumbnail((512,512), Image.Resampling.LANCZOS)
    im.save(out / f'tree{i}.png')
    cutouts[str(i)]={'aspect':aspect,'url':'data:image/png;base64,'+base64.b64encode((out / f'tree{i}.png').read_bytes()).decode()}
(root / 'src/texture/tree_cutouts.json').write_text(json.dumps(cutouts))
