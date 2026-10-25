"""Pack downloaded CC0 maps (see textures/README.md). Requires Pillow.
Usage: python scripts/prepare_tree_textures.py /directory/with/source/maps
"""
from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageChops

source = Path(sys.argv[1])
target = Path(__file__).resolve().parents[1] / 'plugins/procedural_trees/textures'
for name in ('pine_bark', 'bark_willow'):
    image = Image.open(source / f'{name}.jpg').convert('RGB')
    image.resize((512, 512), Image.Resampling.LANCZOS).save(target / f'{name}.jpg', quality=88, optimize=True)
# Extract leaf/needle UV islands, excluding unrelated atlas contents.
for name, crop in [('broadleaf', (700, 170, 865, 300)), ('needles', (0, 20, 250, 460))]:
    image = Image.open(source / f'{name}.png').convert('RGBA')
    mask = Image.open(source / f'{name}_alpha.png')
    if mask.mode.startswith('I'):
        mask = mask.point(lambda value: value / 257).convert('L')
    image.putalpha(mask.convert('L'))
    image = image.crop(crop)
    if name == 'broadleaf':
        # Exclude adjacent UV islands and texture dilation outside this leaf.
        mask = Image.new('L', image.size)
        ImageDraw.Draw(mask).polygon([(10,129),(17,100),(35,75),(62,52),(96,27),(137,6),(153,7),(161,24),(162,52),(149,77),(122,99),(90,117),(55,128),(20,129)], fill=255)
        image.putalpha(ImageChops.multiply(image.getchannel('A'), mask))
    if name == 'needles':
        mask = Image.new('L', image.size)
        ImageDraw.Draw(mask).polygon([(110,0),(210,30),(245,150),(215,270),(165,310),(165,435),(120,435),(90,315),(25,210),(0,70)], fill=255)
        image.putalpha(ImageChops.multiply(image.getchannel('A'), mask))
    image.thumbnail((512, 512), Image.Resampling.LANCZOS)
    image.save(target / f'{name}.png', optimize=True)
