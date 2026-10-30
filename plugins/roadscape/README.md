# Roadscape v3 — road networks for 3D Bench

Draw roads the way a city builder does, then bake them into ordinary low-poly meshes. The plugin is a standalone file plugin (`plugins/roadscape.js`) like Procedural Buildings. It is based on the **Roadscape 4.13.10** artwork by **Baptiste Mollicone and SLX** and runs offline.

## Install

Load **`plugins/roadscape.js`** through **File → Plugins → Load Plugin from File**. In a Generic Model project the **Roadscape** sidebar and **Tools → Draw Road** appear.

## Drawing

1. **Draw Road** (sidebar or Tools). Click points in the viewport; a ghost shows exactly what will be built.
2. Click an **existing road point** to start from it, or click **on a road** to branch from it: the road is split there and connected. Roads that cross become a junction automatically. Roads at different heights (an overpass with enough clearance) stay separate.
3. **Enter**, double-click or right-click finishes and keeps the tool active for the next road. **Esc** cancels the draft, and **Esc** again leaves the tool. **Backspace** removes the last point. **Shift** locks an axis, **Alt** turns snapping off for one click, and clicking the first point again closes a loop.
4. **Auto-setup junctions** in the sidebar connects any roads that now touch or cross (for example after moving points by hand).

**Finish Road** commits a draft and keeps drawing active. **Finish & Edit Points** commits it and switches directly to the Move tool with that network selected. **Cancel Drawing** discards the draft and returns to editing. The sidebar identifies drawing mode, so choosing a road type while drawing changes the next road rather than restyling an existing one.

Drawing stays attached to the network you selected, even when several networks exist. Moved, rotated and scaled networks use the correct local coordinates for both the ghost and finished road. Snapping remains consistent in orthographic views; Alt bypasses both grid and road snapping for the current click.

Each road network is one small native mesh: points are vertices, roads are edges. Use **Edit Points** and the normal **Move** tool to reshape it; the road follows live. Clicking a surface selects its network; another click in vertex mode selects the nearest control point. **Select Road Edges** lets you pick a single road directly from its surface, without also editing other roads between selected points. Extruding an edge makes a new road of the same type. **Insert Road Point** / **Remove Road Point** (Tools menu or context menu) add or delete points; removing a point from the middle of a road joins its neighbours. **Tools → Use Selected Spline as Road** turns a native spline into a road.

## Road types and roadsides

A road type is a carriageway (lanes, lane width, median, markings, crossings, surface) plus a **side stack** on each side. A side stack lists, from the road edge outward, any number of **strips** (gutter, curb, sidewalk, grass verge, shoulder, bike lane, parking lane, racing curb) and **linings** placed on the strip before them:

| Lining | Notes |
| --- | --- |
| Street lamp, bollards, road studs, rocks | Repeated props. Spacing, jitter, size variation, density, end clearance. Optional stagger across the road and optional placement at junction corners. |
| Procedural tree | Grown with the Procedural Trees generator: preset, height, variations, triangles per tree and seed. |
| Guardrail, hedge, fence, wall | Continuous: swept along the curve. |
| Concrete barrier | Pieces stretched to fit end to end. |

Pick a library type (street, tree-lined street, avenue with median, highway, bridge road, tunnel road, race track, trail, country road) for the selected roads, or change anything: the first edit copies a library type into the project so the library itself never changes. When no points or edges are selected, choosing a type updates the network default and roads using that default. A project type is shared by every road that uses it, so one edit restyles a whole city street; **Make own copy** splits it off for the selected roads.

Select road points in vertex mode to change a road's type, its smoothing, whether it is built as a bridge or tunnel, or to force a node to be (or never be) a junction.

Numeric inputs keep partially typed values while the viewport regenerates. Enter or leaving the field commits one undo step; Escape restores the saved value. Empty or invalid input does not become zero.

## Junctions

Junctions are generated, not drawn: arms are sorted around the point, set back according to the corner radius, and joined with rounded, layered curbs and sidewalks for every strip of every arm. Different road types meet cleanly. Crossings, stop lines, corner lamps and dead-end caps follow the settings in **Junctions**. Corner radius shrinks automatically when a road is too short to fit it.

## Bridges and tunnels

`Built as: Automatic` picks a bridge when a road rides above the ground height by more than the bridge threshold and a tunnel when it is below by more than the tunnel threshold. Bridges get a deck with piers; tunnels get walls, a ceiling, lamps and jet fans. Either can be forced per road or per type.

## Game-ready geometry

* **One model per prop.** Props are optimised once at build time with an attribute-preserving edge-collapse simplifier (UV seams, borders and texture drift are costed, hidden faces are culled by rendering them from many directions). A 4,300-triangle jet fan becomes about 390 triangles and a 1,740-triangle streetlight 150, with no second "detailed" model.
* **Adaptive sampling.** Long straights are a handful of quads; only bends receive rings, controlled by **Curve error**.
* **Budget.** Set a triangle budget and turn on *Thin props to fit the budget*. Instead of switching to lesser models, repeated props are thinned in a stable, repeatable way (trees first, then lamps and the rest; surfaces and rails never). The sidebar shows triangles by part.
* **Caching.** Every road and junction is cached, so editing one road only rebuilds that road and the junctions it touches.

## Baking

**Bake** (sidebar, or **Tools → Bake Roadscape to Meshes**) replaces the live network with a group of ordinary meshes: one per part (road surface, sidewalk, lamps …) with one atlas texture for the road and one for trees. The transform of the control mesh is kept, it is one undo step, and undoing brings the editable network back. Bake before exporting glTF or OBJ.

## Older projects

Single-path live roads from Roadscape v2 open as networks: the old style becomes a road type and the path becomes a chain of roads.

## Development

```sh
npm run build:roadscape   # optimise props, pack the library, bundle plugins/roadscape.js
npm run test:roadscape    # unit tests (Node)
npm run test:roadscape-scene
```

* `src/core` is plain TypeScript with no editor dependency: curves, road graph, profiles, junction and structure generation, instancing, optimiser. `src/editor` is the Blockbench integration: mesh sync, live display, drawing tool, bake and the sidebar (small single-purpose Vue components under `src/editor/panel`).
* `assets/packed_library.ts` is generated from `.local-assets/roadscape/library.json` and tracked, so a clean checkout builds without the source artwork. `assets/prop_report.json` lists what the optimiser did to each prop.
* To re-extract the artwork from the supplied Blender file see `scripts/import_roadscape.py`.

Adapted for 3D Bench on 2026-10-28. GPL-3.0-or-later; the supplied license and attribution are in `legal/`.


## ambientCG surface upgrade

Roads, wet roads, gutters, verges and trails use separate ambientCG PBR sheets shared with City Builder. Keep `citybuilder/textures/pbr/` beside `roadscape.js`, even when only Roadscape is loaded. Gutters use Concrete032. Sidewalks and curbs retain their original Roadscape atlas textures. Preview uses filtered 1K mips; mesh baking retains the full 4K albedo/normal sheets and splits ORM into native occlusion, roughness and metallic channels. Props and lane-marking artwork retain the original atlas. See `citybuilder/ASSETS.md` for sources and licenses. Ground-road edges receive continuous terrain contact shoulders along curved segments, rounded junction corners and dead-end caps. Contact uses the same boundary curves as the sidewalk, samples the final graded surface at most every 2.5 metres, and rebuilds when the terrain changes; bridges, tunnels and open spans are excluded.
