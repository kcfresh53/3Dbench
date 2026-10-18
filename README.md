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
| `js/modeling/rig/humanoid/` | Bodiez shape customization, local templates, and procedural humanoid components |
| `js/texturing/pbr_channels.ts` | PBR channel definitions |
| `js/texturing/bake/` | Rasterizer, BVH, bake passes, dilation |

## License

3D Bench is licensed under the GPL version 3, like Blockbench. See `LICENSE.MD`.
Blockbench is created by Jannis Petersen and contributors.

## Compatibility and development checks

The `Blockbench` scripting API and `.bbmodel` file identifiers remain compatible with upstream projects and plugins. Upstream credits and documentation links are retained; application releases and issue reporting point to this fork. Desktop settings continue to use the existing `3DBench` data directory.

Run `npm run test:humanoid-scene` to check the live modal, viewport updates and zoom, cancellation, scene creation, and undo/redo in Electron. Run `npm run test:humanoid` to check generated geometry, closed surfaces, winding, skin weights, symmetry, rig names and the triangle budget. Locally installed chibi templates also have geometry, UV, material and weight preservation checks.

## Customizable male and female bases

Male base and Female base use the locally installed Bodiez meshes. The creation dialog includes an isolated live 3D preview: drag to orbit, scroll to zoom, and double-click to reset the camera. Changes update before anything is added to the project; Cancel discards the preview and Add Humanoid creates one undoable character. Visible sliders provide continuous body-type blending (Thin → Regular → Muscular → Heavy), head size, body size, shoulders, female breast size, short proportions, hips, arm size and leg size. Combine them freely; body-type landmarks are at 0, 1, 2 and 3, and size controls are neutral at 1. Proportion changes use the source skin weights and resize the rest skeleton with the surface, preserving connected joints and finger chains. Short proportions shorten the torso and legs relative to the head; Height still sets the final overall height. Optional ears and a single-mesh option remain available. Shapes are baked into editable geometry using the source Blender shape-key deltas. The source A-pose, polygon topology, UVs and deform rig (including individual fingers) are retained. Ears use the head bone where the separate source ear rig has no matching influence. Height normalizes the chosen body's floor and top while scaling the skeleton together. No textures, subdivision, Blender control widgets, drivers or embedded scripts are loaded.

Install or regenerate both bases from the supplied folder:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python scripts/import_bodiez.py -- "/path/to/Bodiez+Customizable+Male+&+Female+Base+Meshes"
```

The importer writes `bodiez_male.json` and `bodiez_female.json` to `.local-assets/humanoid/`. These commercial source assets stay local, are ignored by Git and are excluded from release packaging. Keep the installed files beside the app's `index.html` (including for a locally deployed web build). Missing installations produce an explicit installation message. Blender is needed only for import; character creation runs inside 3D Bench. The previous bundled male FBX and procedural female are no longer used by these presets. Chibi presets retain their existing workflow.

## Local character templates

Male Chibi base and Female Chibi base use the purchased SD Characters Models Base Pack meshes directly. Install your local copy using Blender (scripts in the source files are disabled):

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python scripts/import_humanoid_templates.py -- "/path/to/SD Characters Models Base Pack.zip"
```

The importer writes to `.local-assets/humanoid/`, which is ignored by Git and excluded from release packaging. These assets are required beside the app's `index.html` to use the presets. They are separate from this repository's GPL source.

Chibi presets create untextured meshes and do not load or add any texture images. The imported template retains UVs mapped to one PNG atlas combining the original face and underwear body composite without resampling, with remapped UVs and padding. Original vertices and A-pose proportions are retained. Each hand adds a four-finger group control and two thumb bones; only hand weights are redistributed, preserving their total influence. Other source weights are retained; the two source pentagons are triangulated for editor compatibility. Height applies a uniform scale. The male has 1,270 triangles and the female has 1,342.
