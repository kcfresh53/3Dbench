# City Builder

Build a game-ready city the way Sim City and Cities: Skylines do, inside 3D Bench.

Load `plugins/citybuilder.js` (File → Plugins → Load Plugin from File). Roadscape (`plugins/roadscape.js`) draws the roads; City Builder reads them. Procedural Trees supplies the tree generator.

## Workflow

1. **Create a city** in the *City Builder* panel: pick a map size and a landscape preset.
2. **Draw roads** with Roadscape (*Draw roads* opens its tool). Use **Generate city layout** for an editable seeded grid, organic network or circuit, with optional zoning. Terrain follows ground roads, or use *Drape roads on terrain* to make the roads follow the land.
3. **Sculpt the land** with the **Landscape** tool: raise, lower, smooth, flatten, level, roughen, erode, terrace, and paint ground surfaces. Ctrl inverts raise/lower, `[` `]` resize the brush.
4. **Zone districts** with the **Zoning** tool: brush, rectangle, polygon, fill, *along road* or *zone along all roads*. Twelve district types (low/medium/high-density residential, low/high commercial, offices, light/heavy industry, civic, park, forest, mixed use).
5. **Watch it grow.** Lots appear throughout painted districts, with road frontage filled first. Each lot gets a building chosen from its district, sized to the lot, taller where land value is high. *Development* raises how many lots are built; existing buildings never move.
6. **Make it game ready** (see below).

Everything is undoable with Ctrl+Z, and the city is stored inside the project file.

## Game ready

* **Export game package…** writes a folder:
  * `buildings/building_N[_lodK].glb` and `buildings/atlas.png`: every distinct building once, in three levels of detail, on packed texture atlas pages. Walls are baked into one quad each; **Preserve facade detail** adds pages to maintain the selected pixel density. Disable it for a compact atlas that reduces resolution to fit. Prefab atlas paths are recorded in the manifest.
  * `terrain/chunk_*.glb`, padded per-chunk albedos (or one shared `terrain/albedo.png`), `terrain/heightmap.bin` (16-bit, header: cols, rows, min, max).
  * `city.json`: prefabs (with collision boxes), building placements, tree placements, stats.
* **Bake city to meshes** turns the live city into ordinary Blockbench meshes (terrain patches, buildings and trees merged per 128 m block).

## Layout

```
src/core/       pure logic, runs in Node: terrain, districts, lots, buildings, game-ready, city pipeline
src/texture/    CPU tile painters for the building atlas
src/editor/     Blockbench layer: store, history, display views, tools, panel
tests/          node:test suites (npm run test:citybuilder)
```

`npm run build:citybuilder` bundles the plugin; `npm run test:citybuilder` runs the tests.

## Terrain, racing roads and editing

Baked city and Roadscape textures use smooth mipmapped filtering, saved in the project. The app's Texture Properties dialog also offers pixel/nearest filtering for artists who prefer it. Restart the rebuilt app and reload both plugins to pick up the new texture property and terrain integration.

**Chunked terrain textures** allocates the chosen resolution to each 32-cell terrain patch, with padded borders. This preserves detail across large maps but consumes more texture memory; disable it to share one map. **Preserve facade detail** likewise trades additional atlas pages for stable facade resolution. A single building that cannot fit reports an error rather than silently reducing quality.

Road shoulders blend over at least two terrain cells, with adjustable blend distance. Automatic structures sample the natural terrain: sustained gaps or water crossings become bridges and piers meet the ground. Classification applies to each complete road control segment; split a segment to tune bridge boundaries. Ground, bridge, tunnel and **Open span / jump (no supports)** overrides remain available. Conforming terrain never moves road control points; **Drape roads on terrain** is an explicit operation that does move them.

The collapsible toolbar at the bottom of the active viewport provides brush selection, biome/district painting, radius and strength. The sidebar retains the full settings. Generated layouts are additive editable Roadscape control meshes; their optional zoning and mesh creation undo together. Existing roads and painted districts are retained.

Core suites and an isolated Electron scene test cover layout undo/redo, district growth, baking, texture filtering persistence and plugin cleanup. Bridges, tunnels and open spans are excluded from ground-road lot frontage.

## Painted districts and biomes

Brush, rectangle, polygon and fill zoning now generate lots throughout the painted area, including areas without roads. Road-front lots are placed first; interiors fill the remaining dry, gentle ground. A painted area must be large enough for the district's lot sizes. Development still controls how many lots are built. Erasing zoning removes its generated buildings; edits support undo/redo.

Paint ground also paints the biome: beach sand grows palms, loamy soil/mud grows broadleaf trees, and snow grows pines. Grass and forest use mixed species. Rock, gravel and pavement suppress trees. Natural vegetation also appears on unzoned land; the tree density and maximum tree controls apply to it.

Trees within 24 metres of a ground road edge use shared realistic Procedural Trees meshes (up to 1,800 triangles); trees outside that band use four-triangle Roadscape cutouts. Trunks stay at least 2 metres outside roads and out of building footprints. Distant palms use cutouts rendered from the generator. Terrain uses bundled ambientCG PBR materials, with no runtime download. See ASSETS.md for sources and licensing.

Bake includes trees in spatial chunks. Game export includes tree meshes, transparent atlases and manifest references; tree materials should be alpha-cutout and two-sided in your engine. The near-road model/cross selection is based on road distance, not camera distance.

## Projects beyond cities: tracks and landscapes

The **Project type** (City, Race track / road scene, Landscape only) only chooses defaults. A track generates and exports terrain, roads and trees without buildings; a landscape keeps just the ground. *Generate buildings*, *Generate trees* and the *Export includes* toggles stay editable afterwards. Switching off a feature also skips its work, so large tracks stay light.

## Roundabouts

Pick the **Roundabout** tool in the viewport toolbar and click a road junction. The roads are cut where they meet the circle, a ring of curved Roadscape segments joins them, and the ground on the island is levelled with no lots on it. Radius (`[` `]`), driving side and ring profile are adjustable. The ring is ordinary Roadscape data, so you can restyle or edit it afterwards. One undo step.

## Road types

The **Road type** tool paints where roads change: ground, bridge, tunnel, open span / jump, or any Roadscape road profile (including your own). Choose a structure and/or profile, then drag a brush along the road, drag a rectangle or click a polygon (Enter applies). Roads are cut at the edges of the painted area, so only the painted stretch changes; slivers shorter than a few metres are absorbed. Leave the structure at *Keep* to change only the profile, or the profile empty to change only the structure.

## Water preview

The water sheet is a preview only and is never exported or baked. The manifest records `waterLevel` so your engine places its own. Its look comes from a port of a Godot 4 water shader (MIT, by "Somebody"): the parameter names (`water_color`, `color_ratio`, `alpha_scale`, `roughness`, `normal`, `time_scale`, `uv_scale`, `depth_distance`, `foam_intensity`, `foam_width`, `shore_fade_distance`…) match, so values can be copied across. The viewport has no screen or depth texture to sample, so the ground colour behind the water comes from the terrain albedo and depth from a depth map of the terrain, and the textures are generated procedurally. Water settings never rebuild the city.

Terrain writes solid depth before its blended PBR layers, then water draws above submerged surfaces. This preserves coastlines and inland puddles when opening older projects without changing their saved heights or water level. `npm run test:citybuilder-water` checks a legacy reload and GPU pixels over ocean, shoreline, puddles and dry land.

## Street layout generator

*Generate editable layout* grows a Roadscape network with a tensor-field street generator (after Chen et al., "Interactive Procedural Street Modeling", SIGGRAPH 2008). A direction field blends grids and radial patterns (and, with *Follow hillsides*, the contour lines of the terrain); streets are traced along it as evenly spaced streamlines, with seeds dropped one spacing to either side of every street so the area fills evenly. Main roads are laid out first with wide spacing, then streets fill in, closer together near the city centres. Streets stop at water and steep ground, end on the street they meet to form junctions, and dead-end stubs are pruned. Layouts: organic (several centres, each with rings and spokes giving way to its own grid), grid, radial (rings and spokes around a plaza) and closed circuit. The result is plain editable control points.

## Island edges

*Island edges* (Landscape section; also a toggle when creating or regenerating terrain) bends the border of the map down below the water line with a ragged coastline. Edge width, sea floor depth, roughness and shape are adjustable. It only ever lowers land and is one undo step.

With **Add ground first** on (the default), island edges do not lower the existing map: new ground is added around all four sides and sloped into the sea, so roads, lots, zoning and sculpting stay exactly where they are. World coordinates of the old map do not change, and the whole step is one undo (it restores the previous map size). The map is capped at 513 vertices per side, so a large map may only grow a little. Turn it off to bend the existing edges instead.


### Road elevation and compact workspace

The City Builder panel has Roads, Terrain, Districts, Export and Project tabs. Roundabout and terrain-fitting settings fold away inside Roads. Buttons wrap and centre their labels in narrow panels.

To author a ramp or viaduct, select road edges (or their control points) forming one open chain on a Roadscape mesh, then choose **Roads → Ramp / elevation**. Set absolute endpoint heights in city metres. The dialog orders endpoints by vertex ID; exchange the two heights to reverse the slope. Straight slope makes a launch approach; Smooth entry and exit eases the vertical curve across the chain while retaining the horizontal road shape. Choose a supported deck, an unsupported jump approach, or a ground embankment. To make a jump, leave a gap between separate launch and landing roads. Tilted meshes must have their tilt applied first.

Bridge columns use existing procedural geometry and terrain heights. A spatial road index keeps columns out of lower roads in the same network; each station tries a bounded set of nearby locations before omitting a blocked column. Support spacing is measured in network metres and affects the whole network. Join road meshes into one network when supports need to avoid their crossings. Other scene objects are not considered by this clearance check. Inspect long unsupported spans before export. Roadscape's existing triangle budget and geometry cache still apply; no new model assets are required.

Road painting does not sculpt the natural heightfield. Unpainted pieces retain their original automatic structure classification when a paint stroke splits a road, preventing a shortened bridge approach from being reclassified as a terrain-filling ground road. Choosing Ground explicitly still permits terrain fitting when Terrain follows roads is enabled. Drape changes road control heights; avoid draping authored ramps.

## River skyline starter and architectural towers

In a new City Builder project, load Roadscape and choose **Create river skyline starter**. Seed 8 is the visual regression scene. This creates a 3072 m landscape around a roughly 1536 m city: a river, a wooded ridge with a wind farm, mixed districts, editable streets and an elevated orbital highway. It places the camera above the city. The layout and zoning support undo/redo together; terrain remains available after undoing the layout. The starter uses up to 30,000 instanced trees. All generated content stays editable through the existing terrain, road and zoning tools.

Office districts now choose elliptical, chamfered, tapered and swept sail towers as well as rectangular, stepped and podium forms. Towers have continuous lofted walls, physical slab edges and corner seams; elliptical towers can have sloping crowns and rooftop helipads. Their silhouettes survive all three export LODs. Rounded glass uses analytic corner normals, preserved through atlas packing and glTF export. Low-density residential includes modern flat-roof villas. **Wind farm** and **Broadleaf woodland** are also available as painted districts; turbines are static procedural meshes and use the ordinary building export pipeline.

The curtain-wall spandrel mask leaves the main window reflective and limits the opaque panel to the floor slab. Building materials use albedo, tangent-space normal and packed ORM maps (R: ambient occlusion, G: roughness, B: metallic). Keep albedo in sRGB and normal/ORM textures as linear data in your engine. Assign them in your engine's material; give the scene its own sky or reflection probes. Atlas pages retain their PBR maps when facade detail preservation splits the export across multiple pages. Reused building prefabs are fitted horizontally to their lots, and the manifest records the same instance scale used by the preview and mesh bake.

**Project → Daylight and shadows** controls the live preview's sky, sunlight and shadow receivers. Renderer shadow preferences are restored when the city is removed, the project changes, or the plugin unloads. Preview lighting is not baked into the building albedo or exported as engine lights. Terrain uses live PBR lighting and shadows; its exported albedo is free of directional lighting. Trees and buildings cast preview shadows; terrain display textures now use anisotropic mipmapped filtering. Building collision remains conservative boxes. Road GLBs are included in the game package; place engine water using the manifest's water level.

The river skyline is a reproducible starting composition inspired by the visual reference, not an exact reconstruction of that image. Its procedural building assets, street network, foliage, terrain and engine lighting still differ from the reference.

Validation: `npm run test:citybuilder`, `npm run test:citybuilder-scene`, and `npm run test:citybuilder-skyline`. The skyline integration test checks the real editor, PBR materials, architectural families, wind farm and native undo/redo, and writes review images under `.local-assets/citybuilder/`.


## High-resolution materials and terrain contact

The material library now includes the requested Grass004, Ground054, Ground048, Rock037, Bricks085 and Plaster003, plus forest floor, gravel, snow, Asphalt012, PavingStones128, Concrete032 and two facade variants (Facade018A replaces the former black night facade). The 4K source pack lives in `citybuilder/textures/pbr/` beside the plugin JS; keep that directory when installing or moving either City Builder or Roadscape. See [ASSETS.md](ASSETS.md) for provenance, repeat sizes and licenses. Full sources and preview mips occupy about 413 MB, kept outside executable JavaScript.

Live terrain uses world-scale PBR tiles rather than stretching a low-resolution color map across the city. A seeded stochastic triangular blend offsets and rotates three source samples to break visible tiling. Color, roughness, metallic, occlusion and normals use the same transforms; normals are inverse-rotated and normalized so highlights stay aligned. Continuous blend weights avoid hard tile borders. Mipmaps and anisotropic filtering stabilize distant views. The live renderer uses 1K filtered mips to bound VRAM; full 4K source sheets remain available to game exports.

**Export game package** writes normal and packed ORM maps for the standard glTF terrain chunks, plus `materials/` with all full-resolution sheets and `terrain/layers_*.png` with normalized RGBA material weights. Road GLBs are included directly in the same package against shared full-resolution materials, along with their centreline graph. Place these world-space meshes and the foundations once at identity. The manifest records world repeat sizes, tints, layer channels and the stochastic algorithm/seed. `materials/stochastic.glsl` and `materials/README.md` explain how to reproduce the mapping in your engine's terrain shader. Use these sources and blend masks for close camera work across large maps: a standard glTF chunk's baked overview is still limited by the selected per-chunk resolution. Blend masks are linear data; disable alpha processing and lossy compression on import. Their PNG encoder preserves independent RGBA channels.

New projects export building facades at 64 px/m on 4096px pages, preserving detail across pages. Export allows up to 256 px/m for close inspection; existing saved projects retain their chosen settings. Brick and plaster sampling uses filtered mip levels when baked smaller, preventing distant aliasing. Apartment variations also use the two ambientCG facade sheets. Roadscape remaps asphalt, gutters, verges and trails to individual PBR materials rather than squeezing them into its shared prop atlas; its mesh bake retains 4K color/normal sheets and individual data channels with undo support.

Road grading fully supports triangles touching the road ribbon before easing back into the terrain. Small lots receive a support margin and a smooth grading ring, with solid foundation skirts sealing any remaining gaps under buildings. Preview, mesh bake and game export share the foundation geometry. Daylight uses sRGB output and filmic tone mapping; prior viewport color and shadow preferences are restored when it is disabled or the city is unloaded. Ground roads also get short contact shoulders meeting the final graded surface. Bridges, tunnels and open spans keep their existing structure behavior. A reload now flushes pending terrain changes before replacing the live state.

Automatic building pads keep the painted terrain material, so leveling a grassy yard does not add paving. Road grading is independent of asphalt coverage, keeping surrounding yards natural. Gutters use Concrete032 PBR sheets; sidewalks and curbs retain their original Roadscape atlas textures. The paving brush remains available for deliberate paved areas. `npm run test:citybuilder-surfaces` checks the live materials and writes close-up review images.
