# City Builder asset provenance

Terrain color maps downloaded 2026-10-28 from ambientCG, licensed under CC0 1.0 Universal (https://docs.ambientcg.com/license/):

- Grass: https://ambientcg.com/a/Grass004
- Forest floor: https://ambientcg.com/a/Ground037
- Beach sand: https://ambientcg.com/a/Ground054
- Loamy soil: https://ambientcg.com/a/Ground048
- Rock: https://ambientcg.com/a/Rock030

The 1K JPG color maps are retained in `textures/`. Portable 256px RGB tiles are embedded in `src/texture/terrain_tiles.json`; terrain rendering and exports sample them at a 12-metre repeat and blend biome borders. Dry meadow and mud are tinted grass and soil. Snow and pavement retain procedural colors. These are baked albedo materials, not a live PBR shader.

Roadscape v4.13.10 tree1.png through tree5.png were copied from the user's supplied Asset Library `textures` directory. Cutouts are alpha-cropped and resized to at most 512px, retaining aspect ratio. Roadscape is distributed under GPL-3.0-or-later; see `ROADSCAPE_COPYING.txt` (copied from the supplied `_COPYING.txt`). The portable versions are in `src/texture/tree_cutouts.json`. No asset-render thumbnails are used as textures.

Near-road trees use the existing Procedural Trees generator's realistic presets and bundled bark/foliage atlas, capped at 1,800 triangles per shared variant. Existing generator provenance: `assets/built_in_plugins/procedural_trees.LICENSE.md` in the repository. Distant palms are rendered to cutouts from this generator because the supplied Roadscape library has no palm cutout.

Run `scripts/prepare_city_textures.py ZIP_DIRECTORY ROADSCAPE_TEXTURE_DIRECTORY` with Pillow to reproduce the embedded assets. Archive names are documented in that script. All assets are embedded in the built plugin for offline use.
