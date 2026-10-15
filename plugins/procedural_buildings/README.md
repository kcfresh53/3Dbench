# Procedural Buildings v5 for 3DBench

A self-contained native JavaScript generator adapted from the supplied FlexiBuilding 1.0.2 assets by Felipe Del Rio. **No Blender installation, external process, source file, network connection, or runtime file permission is required.** Geometry, textures and preset layouts are compressed into the plugin and decoded inside 3DBench as needed.

## Install

Reload `plugins/procedural_buildings.js` in **File → Plugins**, or use **Load Plugin from File**. In a Generic Model project, open **Tools → Procedural Building…**.

## Model a live building layout

1. Start with a **mesh cuboid** in a Generic Model project. Select that single mesh, right-click, and choose **Use Mesh as Building Layout…**.
2. Choose the style and details in the usual preview dialog, then **Apply Live Building**. **Module size** sets the architectural bay/floor spacing; the building fits the cage's actual dimensions.
3. Edit the original cage using vertex/edge/face selection, **Loop Cut** and **Extrude**. Facades and roofs update while you model. Selected faces and cage edges remain visible through the building. Moving or rotating the object moves the building with it.
4. Right-click **Edit Live Building…** to change its appearance, or **Remove Live Building** to return to the plain cage. These actions support undo.
5. Save the editable cage and settings as `.bbmodel` with the plugin loaded. Before exporting ordinary geometry, use **Bake Building to Meshes**. Baking replaces the cage with textured, editable building meshes; undo restores the live cage.

Layouts must be closed, axis-aligned, box-based meshes with a common flat bottom. L/U wings, courtyard holes and stepped roofs are supported. Coplanar loop cuts alone do not change the facade. Slopes, curved walls, overhangs and stacked cavities are not supported: the generator shows the cage and an explanation until you correct or undo the edit. Live buildings are derived viewport instances, so **bake before exporting** to OBJ, glTF or other mesh formats. The mesh layout follows local coordinates; object rotation is supported.

## FlexiBuilding controls

- Ten architectural styles and fifty original preset layouts, with their source module transforms and accessories preserved.
- Procedural rectangle, L, U and courtyard footprints; adjustable width, depth, floors and scale. Concave and convex corners use the corresponding source modules.
- Five palettes per style, using extracted source color values to recolor baked texture regions.
- Plain-wall and fire-escape facade controls.
- Seeded rooftop equipment, water tanks, antennas, skylights, solar panels and air conditioners. Original presets can retain the creator’s exact accessory placement.
- Seeded window lighting, light color and brightness baked into a texture variant.
- Automatic textured preview, native editable meshes, saved settings, regeneration, undo/redo and normal mesh exports.

Changing style/layout loads its original palette. Use **Footprint** to switch from the exact preset to editable bay and floor counts. Under **Rooftop & facade**, disable **Keep original preset accessories** to generate your own arrangement. Preview changes happen inside the app; no background renderer is launched.

Select a generated group or a child mesh and choose **Tools → Edit Procedural Building…**. Regeneration preserves the group’s transform and replaces its contents, including manual mesh edits. Undo restores the previous geometry, texture and settings. Load the plugin before opening a `.bbmodel` to retain its custom generator metadata.

The approved earlier three-kit generator remains under **Tools → Legacy Building Kits…**. Existing v2 groups use that editor.

## Fidelity and limits

All fifty preset triangle counts were checked against the evaluated source. Preset module transforms are extracted directly; new footprints and seeded accessories are calculated in JavaScript. Native random arrangements do not reproduce Blender’s random-number sequence.

Materials are baked. Palette recoloring approximates the source shader response; live parallax, reflections, normal/bump shaders and emissive scene illumination are not reproduced. Interior imagery repeats with its source module. Source modules share UV tiles, so editing a texture tile affects repeated instances. Window lighting changes the texture appearance.

The native UI provides the listed footprint and facade controls; arbitrary Blender Geometry Nodes graphs, custom module collections, shader replacements and the source’s per-face rooftop authoring tools are not ported. A 1.5-million-triangle guard protects interactive generation.

## Development rebuild

Blender is a **development-only importer**, not a dependency of the finished plugin. To rebuild artwork from the supplied file, run this for style numbers 1 through 10:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python scripts/import_flexibuilding.py -- /path/to/FlexiBuilding.blend 1
npm run build:buildings
npm run test:buildings
```

The importer writes Git-ignored files beneath `.local-assets/flexibuilding/native/`. Existing `styleN-palette1.png` files are bake caches; remove the relevant generated cache before rebuilding textures from a changed source. The build script compresses all ten libraries into the self-contained plugin. The legacy library must also be available from its importer below. Extraction was tested using Blender 5.2.1.

Plugin implementation: GPL-3.0-or-later. The source architecture and materials remain Felipe Del Rio’s artwork under their original license. This adapted bundle is for the user’s local use; redistribution of the source artwork is subject to the supplied license.

## Legacy generator reference

### The three supplied kits

- **Red brick:** arched middle-floor windows, rectangular upper windows, molded cornices, window awnings and plants.
- **Terracotta:** detailed window surrounds, ornate balconies, air conditioners and storefronts.
- **Industrial:** gridded windows, vertical masonry divisions, awnings and planted window boxes.

Changing the kit loads its source example’s dimensions and detail amounts. Width/depth count facade bays. Middle and upper floors are separate tiers, above one included storefront floor. Overall scale preserves the proportions of all modules. The roof and divider pieces come from the selected kit.

Detail sliders are labeled for the current kit. They control the percentage of eligible modules receiving an accessory. The seed gives repeatable variation. The JavaScript random sequence is independent of Blender’s random-number implementation; structural placement matches Blender, while accessory locations may differ for the same numeric seed.

Drag to orbit the textured preview, scroll to zoom, and double-click to reset. Previewing does not change the project. Creating a building produces editable meshes grouped under one building, with baked texture UVs and one undo step.

Select a building or one of its meshes and use **Tools → Edit Procedural Building…** to regenerate. Regeneration replaces that group’s contents, including manual edits, while preserving its group transform. Undo restores the earlier geometry, texture and settings. Save as `.bbmodel` and load the plugin before reopening to preserve the custom generator metadata. Version 1 buildings can be replaced using the new generator, but their old styles do not have direct equivalents.

## Fidelity and limits

The importer evaluates the source mesh modifiers, preserves the modeled arches, recesses, moldings, balcony railings, awnings and plants, and triangulates only polygons with more than four vertices. Blender’s procedural surface colors and local ambient-occlusion shading are baked into an atlas. Reflective window panes receive a dark diffuse fallback so they remain glazing in the standard texture renderer. Live Blender shader effects such as metallic reflections, bump mapping and scene lighting are not carried over as procedural shaders.

The source geometry is an exterior module kit; it is not a single watertight solid or an interior floor plan. Native exports contain ordinary meshes and textures. A two-million-triangle limit prevents extreme combinations from creating unnecessarily large editable scenes. Source modules share their UV tiles, so painting a tile affects its repeated instances.

## Rebuild from the supplied file

On this Mac:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python scripts/import_building_modules.py -- "/path/to/blender-procedural-buildings.blend"
npm run build:buildings
npm run test:buildings
```

The importer also supports the Geometry Nodes modifier input API used before Blender 5.2. Embedded Blender-file scripts are disabled. It writes adapted geometry and textures to `.local-assets/buildings/`, which is ignored by Git, and reference placements to `tests/fixtures/buildings_placements.json`. The file hash and source attribution are recorded in the library. The bundled plugin is generated locally from these files.

The placement tests compare every structural instance against the evaluated Blender examples: 200 for Building 1, 290 for Building 2, and 202 for Building 3. Additional tests cover rectangular dimensions, normalization, source UVs/normals, deterministic details, mirrored winding, editable geometry, and the geometry budget. Asset tests are skipped when the local source library has not been imported.

Plugin implementation: GPL-3.0-or-later, consistent with 3DBench. The source architecture and materials are Felipe Del Rio’s artwork; their original terms apply to the adapted assets.

