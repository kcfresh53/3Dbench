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
  * `buildings/building_N[_lodK].obj` and `buildings/atlas.png`: every distinct building once, in three levels of detail, on packed texture atlas pages. Walls are baked into one quad each; **Preserve facade detail** adds pages to maintain the selected pixel density. Disable it for a compact atlas that reduces resolution to fit. Prefab atlas paths are recorded in the manifest.
  * `terrain/chunk_*.obj`, padded per-chunk albedos (or one shared `terrain/albedo.png`), `terrain/heightmap.bin` (16-bit, header: cols, rows, min, max).
  * `city.json`: prefabs (with collision boxes), building placements, tree placements, stats.
  * `city_loader.gd`: a statically typed Godot 4 script that builds the city from `city.json`.
* **Bake city to meshes** turns the live city into ordinary Blockbench meshes (terrain patches, buildings and trees merged per 128 m block).
* **Make selection game ready** (also in the mesh context menu) works on any mesh or group: removes faces no viewpoint can see, simplifies it while keeping the silhouette, and writes LOD0/1/2 beside the original.

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

Core suites and an isolated Electron scene test cover layout undo/redo, district growth, baking, texture filtering persistence and plugin cleanup. The generated Godot loader has not been executed in Godot. Bridges, tunnels and open spans are excluded from ground-road lot frontage.

## Painted districts and biomes

Brush, rectangle, polygon and fill zoning now generate lots throughout the painted area, including areas without roads. Road-front lots are placed first; interiors fill the remaining dry, gentle ground. A painted area must be large enough for the district's lot sizes. Development still controls how many lots are built. Erasing zoning removes its generated buildings; edits support undo/redo.

Paint ground also paints the biome: beach sand grows palms, loamy soil/mud grows broadleaf trees, and snow grows pines. Grass and forest use mixed species. Rock, gravel and pavement suppress trees. Natural vegetation also appears on unzoned land; the tree density and maximum tree controls apply to it.

Trees within 24 metres of a ground road edge use shared realistic Procedural Trees meshes (up to 1,800 triangles); trees outside that band use four-triangle Roadscape cutouts. Trunks stay at least 2 metres outside roads and out of building footprints. Distant palms use cutouts rendered from the generator. Terrain uses bundled ambientCG color maps, with no runtime download. See ASSETS.md for sources and licensing.

Bake includes trees in spatial chunks. Game export includes tree meshes, transparent atlases and manifest references; the Godot loader applies two-sided alpha cutout materials automatically. Custom tree scenes remain an optional override. The near-road model/cross selection is based on road distance, not camera distance.
