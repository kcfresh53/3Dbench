# Tree textures

Realistic presets include offline photographic textures derived from **Poly Haven CC0 assets**:

| File | Original asset | Processing |
| --- | --- | --- |
| `bark_willow.jpg` | https://polyhaven.com/a/bark_willow | Diffuse, resized to 512 px |
| `pine_bark.jpg` | https://polyhaven.com/a/pine_bark | Diffuse, resized to 512 px |
| `broadleaf.png` | https://polyhaven.com/a/tree_small_02 | Leaves diffuse + alpha, one photographed leaf cropped and masked; geometry supplies the spray |
| `needles.png` | https://polyhaven.com/a/pine_tree_01 | Twig diffuse + alpha, needle sprig cropped and masked |

License: https://polyhaven.com/license and https://creativecommons.org/publicdomain/zero/1.0/
CC0 permits commercial use, modification and redistribution. The code's GPL license does not restrict the CC0 assets. Source maps were downloaded on 2026-10-24 through https://api.polyhaven.com/files/ASSET_ID (1k).

`src/texture/bundled.ts` embeds these processed files so the standalone plugin has no runtime downloads or path dependencies. After changing the PNG/JPG files, run `npm run build:trees` to refresh the embedded data and standalone bundle. `scripts/prepare_tree_textures.py` documents the crop/resize/alpha conversion from source maps (requires Pillow).

## Your own textures

Use **Texture slots** in the dialog to override either default with a local PNG/JPG/WebP. Bark is mirrored vertically across repeats. Leaf images should have a transparent background and contain one sprig or cluster, rather than a sheet of unrelated UV islands. Inputs are embedded in the tree's saved settings, so regeneration works after reopening the project. Clear a slot to restore its default; disable **Photographic defaults** for procedural paint. Stylized presets always use procedural defaults.

The atlas is one base-color/alpha material. Normal, roughness and displacement maps are not currently packed. Birch uses pale procedural bark with horizontal lenticels; the default broadleaf photograph is a generic sprig rather than a species-specific oak/birch scan. The secondary leaf color tints bundled pine needles. Other color controls affect procedural regions.

## Textures.com

The requested https://www.textures.com/free page offers a free European beech atlas at https://www.textures.com/download/3d-scanned-european-beech-tree-leaves-atlas-01/133410 . Downloads require an account. Its separate color and alpha maps must be combined into a transparent PNG (and a suitable sprig cropped out) before importing; TIFF is not supported by the image slots.

Textures.com explicitly prohibits bundling its materials with graphics programs or plugins, and prohibits redistributing Special Content such as atlas scans with stock models, even after modification. No Textures.com files are included. Local imports must be used according to your license; importing a texture does not grant redistribution rights. See https://www.textures.com/faq-license and https://www.textures.com/about/terms-of-use .

Palm presets use dedicated procedural ringed bark and green leaflet surfaces. The lower-right atlas field is used for their frond stems, so it is retained for palms.
