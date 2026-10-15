# 3DBench

3DBench is a modern 3D modelling, texturing and animation platform with a simple, approachable interface.
It is a fork of [Blockbench](https://github.com/JannisX11/blockbench) that drops all game-specific pipelines and focuses on a generic workflow: model, unwrap, texture, rig and export to standard formats (glTF, OBJ, FBX, STL, Collada).

## What is different from Blockbench

* **Generic only.** All Minecraft formats and tooling (Java/Bedrock, entity, skin, OptiFine, block display, resource pack handling) are removed.
* **Smart UV unwrapping.** Angle-based seam detection, LSCM parameterization with ARAP refinement, automatic cutting of closed or high-genus charts, distortion-driven chart splitting and a bitmap-based island packer with rotation and texel density control.
  Find it as *Smart Unwrap* / *Pack Islands* / *Equalize Texel Density* in the Mesh menu and UV editor.
* **Rigging.** Heat-diffusion automatic weights, weight smoothing and limiting, bone chain creation and bone mirroring.
* **Humanoid generator.** Creates a fully rigged, weighted and optionally unwrapped humanoid from presets (average, stylized, chibi, heroic, child, blocky) with Godot, Unity, Mixamo or simple bone naming. Available from the outliner add menu.
* **Texturing.** Generic PBR channels (color, normal, height, roughness, metalness, emissive, ambient occlusion) with one texture per channel, a map baker (ambient occlusion, thickness, curvature, object normal, position, mesh ID), edge padding, and a UV test grid generator.
* **Modelling tools inspired by Blender.** Subdivide with Catmull-Clark smoothing, smooth/relax vertices, flatten vertices, recalculate normals, select linked / grow / shrink (`L`), alongside the existing loop cut, inset, extrude, knife and proportional editing.

## Launching from source

* Install [NodeJS](https://nodejs.org/en/) and run `npm install`.
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

3DBench is licensed under the GPL version 3, like Blockbench. See `LICENSE.MD`.
Blockbench is created by Jannis Petersen and contributors.
