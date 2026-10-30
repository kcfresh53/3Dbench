# City Builder asset provenance

## ambientCG PBR materials

Official 4K-JPG material archives downloaded 2026-10-29–30 from ambientCG, under [CC0 1.0](https://docs.ambientcg.com/license/):

| Use | Asset | Repeat (metres) |
| --- | --- | --- |
| Grass / dry meadow | [Grass004](https://ambientcg.com/view?id=Grass004) | 1.4 × 1.4 |
| Beach sand | [Ground054](https://ambientcg.com/view?id=Ground054) | 3.5 × 3.5 |
| Dirt / wet mud | [Ground048](https://ambientcg.com/view?id=Ground048) | 1.4 × 1.4 |
| Rock | [Rock037](https://ambientcg.com/view?id=Rock037) | 4 × 4 |
| Forest floor | [Ground037](https://ambientcg.com/view?id=Ground037) | 2 × 2 |
| Gravel | [Gravel033](https://ambientcg.com/view?id=Gravel033) | 2 × 2 |
| Snow | [Snow001](https://ambientcg.com/view?id=Snow001) | 4 × 4 |
| Asphalt / wet asphalt | [Asphalt012](https://ambientcg.com/view?id=Asphalt012) | 8 × 8 |
| Paving | [PavingStones128](https://ambientcg.com/view?id=PavingStones128) | 3.5 × 3.5 |
| Brick | [Bricks085](https://ambientcg.com/view?id=Bricks085) | 2.4 × 1.2 |
| Plaster / foundations | [Plaster003](https://ambientcg.com/view?id=Plaster003) | 3 × 3 |
| Gutters | [Concrete032](https://ambientcg.com/view?id=Concrete032) | 2 × 2 |
| Facade variations | [Facade018A](https://ambientcg.com/view?id=Facade018A), [Facade015](https://ambientcg.com/view?id=Facade015) | 13 × 13 / 12 × 12 |

Rock, snow, asphalt, forest, plaster, concrete and Facade015 repeat sizes are art-direction choices; dimensions supplied by the asset are retained for grass, sand, dirt, gravel, paving, brick and Facade018A. Meadow and mud tint existing sources; wet mud and asphalt reduce roughness.

`textures/pbr/` contains 42 full-resolution JPEG sheets: albedo, OpenGL tangent-space normal and packed ORM (R occlusion, G roughness, B metallic). All remain 4096px wide; the brick sheet is 4096 × 2048. Sources are re-encoded at JPEG quality 90 without chroma subsampling, retaining full spatial resolution. The masks are lossy JPEG data; engines should use the supplied lossless baked PNG maps when compression artefacts are unsuitable. Source archive SHA-256 hashes, dimensions and URLs are recorded in `src/texture/ambientcg_manifest.json`. Albedo contains no added sun lighting.

The live terrain uses seeded stochastic world-space tiling with three offset/rotated samples, blended photographic PBR materials and filtered 1K GPU mips (embedded in `ambientcg_data.json`), with trilinear filtering and anisotropy. CPU bakes select mip levels by pixel footprint to avoid distance aliasing. Game packages also copy the full 4K sheets and normalized RGBA blend masks, with a material recipe in `materials/README.md`. Import those masks as linear data without alpha processing. Their PNG writer preserves independent channels, including RGB where alpha is zero. Standard glTF chunks retain padded baked PBR textures as a portable overview fallback. Building atlases use photographic brick, plaster and facade variants; their export density is configurable independently of source resolution.

Keep the `citybuilder/textures/pbr/` directory beside `citybuilder.js` when installing or moving the plugin. Roadscape uses the same directory, including when City Builder is not active. No runtime downloads are made. Full sources plus separate preview mips occupy about 413 MB. Reproduce it with `scripts/prepare_city_pbr.py ARCHIVE_DIRECTORY` and Pillow. Legacy `terrain_tiles.json` and old color-only images are retained only for the older preparation script; the new renderer does not use them.

The vendored JPEG decoder is from jpeg-js 0.4.4, Copyright Eugene Ware (BSD-3-Clause), based on notmasteryet's decoder (Apache-2.0). Notices and license text are retained in `src/texture/vendor/`.

Roadscape v4.13.10 tree1.png through tree5.png were copied from the user's supplied Asset Library `textures` directory. Cutouts are alpha-cropped and resized to at most 512px, retaining aspect ratio. Roadscape is distributed under GPL-3.0-or-later; see `ROADSCAPE_COPYING.txt` (copied from the supplied `_COPYING.txt`). The portable versions are in `src/texture/tree_cutouts.json`. No asset-render thumbnails are used as textures.

Near-road trees use the existing Procedural Trees generator's realistic presets and bundled bark/foliage atlas, capped at 1,800 triangles per shared variant. Existing generator provenance: `assets/built_in_plugins/procedural_trees.LICENSE.md` in the repository. Distant palms are rendered to cutouts from this generator because the supplied Roadscape library has no palm cutout.

Run `scripts/prepare_city_textures.py ZIP_DIRECTORY ROADSCAPE_TEXTURE_DIRECTORY` with Pillow to reproduce the embedded assets. Archive names are documented in that script. Tree cutouts are embedded in the built plugin for offline use; full-resolution PBR resources are separate offline files.

## Water preview shader

`src/editor/display/water_shader.ts` is a port of a Godot 4 water shader (MIT licence, by "Somebody", as supplied by the project owner) to a three.js `ShaderMaterial`. Its ripple, glitter and foam textures are generated at run time by `src/core/water/textures.ts`; nothing is downloaded. The water is a viewport preview only and is not exported.
