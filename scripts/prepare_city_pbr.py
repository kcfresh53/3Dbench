"""Build the offline ambientCG material library from official 4K-JPG zip downloads.

Usage: python scripts/prepare_city_pbr.py .local-assets/ambientcg [material_id ...]
Requires Pillow and numpy. Source archives are never committed; no preview renders are used.
"""
from pathlib import Path
import base64, hashlib, io, json, sys, zipfile
from PIL import Image, ImageFile
import numpy as np
ImageFile.MAXBLOCK = 128 * 1024 * 1024

ROOT = Path(__file__).resolve().parents[1] / 'plugins/citybuilder'
# Repeat dimensions in metres. Non-square brick sheets retain their aspect ratio.
MATERIALS = {
    'grass': ('Grass004', 1.4, 1.4), 'sand': ('Ground054', 3.5, 3.5),
    'dirt': ('Ground048', 1.4, 1.4), 'rock': ('Rock037', 4, 4),
    'forest': ('Ground037', 2, 2), 'gravel': ('Gravel033', 2, 2),
    'snow': ('Snow001', 4, 4), 'asphalt': ('Asphalt012', 8, 8),
    'paved': ('PavingStones128', 3.5, 3.5), 'brick': ('Bricks085', 2.4, 1.2),
    'plaster': ('Plaster003', 3, 3),
    'concrete': ('Concrete032', 2, 2),
    'facade_a': ('Facade018A', 13, 13), 'facade_b': ('Facade015', 12, 12),
}
selected = set(sys.argv[2:])
if selected - MATERIALS.keys():
    raise ValueError(f'Unknown materials: {selected - MATERIALS.keys()}')
packed = json.loads((ROOT / 'src/texture/ambientcg_data.json').read_text()) if selected else {}
metadata = json.loads((ROOT / 'src/texture/ambientcg_manifest.json').read_text()) if selected else {}
sources = ROOT / 'textures/pbr'
sources.mkdir(parents=True, exist_ok=True)
(sources / 'preview').mkdir(exist_ok=True)
for key, (asset, mw, mh) in MATERIALS.items():
    if selected and key not in selected:
        continue
    archive = Path(sys.argv[1]) / f'{asset}_4K-JPG.zip'
    with zipfile.ZipFile(archive) as z:
        def read(channel, fallback):
            name = next((n for n in z.namelist() if n.endswith('_' + channel + '.jpg')), None)
            if name:
                return Image.open(io.BytesIO(z.read(name))).convert('RGB')
            if channel == 'Color':
                raise ValueError(f'{archive}: required Color map missing')
            return Image.new('RGB', color.size, fallback)
        color = read('Color', 'white')
        normal = read('NormalGL', (128, 128, 255))
        rough = read('Roughness', (230, 230, 230)).convert('L')
        ao = read('AmbientOcclusion', 'white').convert('L')
        metal = read('Metalness', 'black').convert('L')
        orm = Image.merge('RGB', (ao, rough, metal))
        maps = {}
        # JPEG is deliberately re-encoded: originals use huge near-lossless JPEGs.
        # Retain the full spatial resolution, with no chroma subsampling of normals/data.
        for channel, image in [('albedo', color), ('normal', normal), ('orm', orm)]:
            buf = io.BytesIO()
            image.save(buf, 'JPEG', quality=90, subsampling=0, optimize=True)
            filename = f'{asset}_{channel}.jpg'
            (sources / filename).write_bytes(buf.getvalue())
            maps[channel] = filename
        # CPU overview bakes use a filtered 1K mip; engines also receive the full 4K sources.
        mip = {}
        for channel, image in [('albedo', color), ('normal', normal), ('orm', orm)]:
            im = image.copy()
            im.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, 'JPEG', quality=90, subsampling=0, optimize=True)
            mip[channel] = base64.b64encode(buf.getvalue()).decode()
            (sources / 'preview' / maps[channel]).write_bytes(buf.getvalue())
        metadata[key] = dict(asset=asset, source=f'https://ambientcg.com/view?id={asset}',
                           license='CC0-1.0', width=color.width, height=color.height,
                           metres=[mw, mh], archiveSha256=hashlib.sha256(archive.read_bytes()).hexdigest(),
                           maps=maps)
        s = np.asarray(Image.open(io.BytesIO(base64.b64decode(mip['albedo']))), dtype=np.float64) / 255
        linear = np.where(s <= .04045, s / 12.92, ((s + .055) / 1.055) ** 2.4)
        metadata[key]['albedoMeanLinear'] = [round(float(x), 8) for x in linear.mean(axis=(0, 1))]
        packed[key] = dict(mip=mip, mipWidth=im.width, mipHeight=im.height)
    print(key, flush=True)
(ROOT / 'src/texture/ambientcg_data.json').write_text(json.dumps(packed, separators=(',', ':')))
(ROOT / 'src/texture/ambientcg_manifest.json').write_text(json.dumps(metadata, indent=2))
