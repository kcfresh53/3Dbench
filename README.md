# 3D Bench

3D Bench is a modern 3D modelling, texturing and animation platform with a simple, approachable interface.
It is a fork of [Blockbench](https://github.com/JannisX11/blockbench) that drops all game-specific pipelines and focuses on a generic workflow: model, unwrap, texture, rig and export to standard formats (glTF, OBJ, FBX, STL, Collada).

## What is different from Blockbench

* **Generic only.** All Minecraft formats and tooling (Java/Bedrock, entity, skin, OptiFine, block display, resource pack handling) are removed.
* **Smart UV unwrapping.** Angle-based seam detection, LSCM parameterization with ARAP refinement, automatic cutting of closed or high-genus charts, distortion-driven chart splitting and a bitmap-based island packer with rotation and texel density control.
  Find it as *Smart Unwrap* / *Pack Islands* / *Equalize Texel Density* in the Mesh menu and UV editor.
* **Rigging.** Heat-diffusion automatic weights, weight smoothing and limiting, bone chain creation and bone mirroring.
* **Humanoid generator.** Creates a fully rigged, weighted and optionally unwrapped humanoid from presets (male, female, and chibi male/female) with Godot, Unity, Mixamo or simple bone naming. Available from the outliner add menu.
* **Texturing.** Generic PBR channels (color, normal, height, roughness, metalness, emissive, ambient occlusion) with one texture per channel, a map baker (ambient occlusion, thickness, curvature, object normal, position, mesh ID), edge padding, and a UV test grid generator.
* **Modelling tools inspired by Blender.** Subdivide with Catmull-Clark smoothing, smooth/relax vertices, flatten vertices, recalculate normals, select linked / grow / shrink (`L`), alongside the existing loop cut, inset, extrude, knife and proportional editing.

## Getting started

* Install [NodeJS](https://nodejs.org/en/) and run `npm ci --include=optional`.
* Electron: `npm run dev`
* Web: `npm run serve`, then open http://localhost:3000

## Code layout of the new systems

| Path | Contents |
| --- | --- |
| `js/modeling/mesh/unwrap/` | UV unwrapper: mesh graph, cutting, LSCM/ARAP, metrics, packer, texel density |
| `js/modeling/mesh/tools/` | Subdivide, smooth, flatten, normals, selection tools |
| `js/modeling/rig/` | Heat weights, weight tools, bone tools |
| `js/modeling/rig/humanoid/` | Component based humanoid generator (torso, neck/head, legs, arms, hands) |
| `js/texturing/pbr_channels.ts` | PBR channel definitions |
| `js/texturing/bake/` | Rasterizer, BVH, bake passes, dilation |

## License

3D Bench is licensed under the GPL version 3, like Blockbench. See `LICENSE.MD`.
Blockbench is created by Jannis Petersen and contributors.

## Compatibility and development checks

The `Blockbench` scripting API and `.bbmodel` file identifiers remain compatible with upstream projects and plugins. Upstream credits and documentation links are retained; application releases and issue reporting point to this fork. Desktop settings continue to use the existing `3DBench` data directory.

Run `npm run test:humanoid` to check generated geometry, closed surfaces, winding, skin weights, symmetry, rig names and the triangle budget. Locally installed chibi templates also have geometry, UV, material and weight preservation checks.

## Male base mesh

The Male base preset uses the supplied low-poly male FBX, adapted to model coordinates and a height of 32 with a fitted 28-bone rig and normalized heat weights (at most four influences per vertex). Its 484 vertices, silhouette and source UVs are retained; polygons larger than quads are triangulated for editor compatibility, producing 964 triangles. Hands use a finger-group control and two thumb controls. It starts in the source A-pose, untextured. Height scales the mesh and skeleton together; procedural shape and pose controls are hidden for this preset. The adapted asset is bundled in `assets/humanoid/male_base.json`.

To regenerate it from the supplied archive:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python scripts/import_male_base.py -- "/path/to/low-poly-male-base-mesh.zip"
```

## Local character templates

Male Chibi base and Female Chibi base use the purchased SD Characters Models Base Pack meshes directly. Install your local copy using Blender (scripts in the source files are disabled):

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python scripts/import_humanoid_templates.py -- "/path/to/SD Characters Models Base Pack.zip"
```

The importer writes to `.local-assets/humanoid/`, which is ignored by Git and excluded from release packaging. These assets are required beside the app's `index.html` to use the presets. They are separate from this repository's GPL source.

Chibi presets create untextured meshes and do not load or add any texture images. The imported template retains UVs mapped to one PNG atlas combining the original face and underwear body composite without resampling, with remapped UVs and padding. Original vertices and A-pose proportions are retained. Each hand adds a four-finger group control and two thumb bones; only hand weights are redistributed, preserving their total influence. Other source weights are retained; the two source pentagons are triangulated for editor compatibility. Height applies a uniform scale. The male has 1,270 triangles and the female has 1,342.
