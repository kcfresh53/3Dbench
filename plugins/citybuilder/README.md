# City Builder

Build a game-ready city the way Sim City and Cities: Skylines do, inside 3D Bench.

Load `plugins/citybuilder.js` (File → Plugins → Load Plugin from File). Roadscape (`plugins/roadscape.js`) draws the roads; City Builder reads them. Procedural Trees supplies the tree generator.

## Workflow

1. **Create a city** in the *City Builder* panel: pick a map size and a landscape preset.
2. **Draw roads** with Roadscape (*Draw roads* opens its tool). Terrain follows the roads, or use *Drape roads on terrain* to make the roads follow the land.
3. **Sculpt the land** with the **Landscape** tool: raise, lower, smooth, flatten, level, roughen, erode, terrace, and paint ground surfaces. Ctrl inverts raise/lower, `[` `]` resize the brush.
4. **Zone districts** with the **Zoning** tool: brush, rectangle, polygon, fill, *along road* or *zone along all roads*. Twelve district types (low/medium/high-density residential, low/high commercial, offices, light/heavy industry, civic, park, forest, mixed use).
5. **Watch it grow.** Lots appear throughout painted districts, with road frontage filled first. Each lot gets a building chosen from its district, sized to the lot, taller where land value is high. *Development* raises how many lots are built; existing buildings never move.
6. **Make it game ready** (see below).

Everything is undoable with Ctrl+Z, and the city is stored inside the project file.

## Game ready

* **Export game package…** writes a folder:
  * `buildings/building_N[_lodK].obj` and `buildings/atlas.png`: every distinct building once, in three levels of detail, all on one packed texture atlas. Walls are baked into one quad each; resolution lowers itself to fit the atlas.
  * `terrain/chunk_*.obj`, `terrain/albedo.png`, `terrain/heightmap.bin` (16-bit, header: cols, rows, min, max).
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

## Limits

* The editor layer (tools, panel, live display) is verified by typechecking and by running the core pipeline in Node, not by an automated test inside the Electron app.
* Trees are placed in the manifest and shown live, but are not baked into meshes.
* Bridges and tunnels from Roadscape are ignored for lot placement.

## Painted districts and biomes

Brush, rectangle, polygon and fill zoning now generate lots throughout the painted area, including areas without roads. Road-front lots are placed first; interiors fill the remaining dry, gentle ground. A painted area must be large enough for the district's lot sizes. Development still controls how many lots are built. Erasing zoning removes its generated buildings; edits support undo/redo.

Paint ground also paints the biome: beach sand grows palms, loamy soil/mud grows broadleaf trees, and snow grows pines. Grass and forest use mixed species. Rock, gravel and pavement suppress trees. Natural vegetation also appears on unzoned land; the tree density and maximum tree controls apply to it.

Trees within 24 metres of a ground road edge use shared realistic Procedural Trees meshes (up to 1,800 triangles); trees outside that band use four-triangle Roadscape cutouts. Trunks stay at least 2 metres outside roads and out of building footprints. Distant palms use cutouts rendered from the generator. Terrain uses bundled ambientCG color maps, with no runtime download. See ASSETS.md for sources and licensing.

Bake includes trees in spatial chunks. Game export includes tree meshes, transparent atlases and manifest references; the Godot loader applies two-sided alpha cutout materials automatically. Custom tree scenes remain an optional override. The near-road model/cross selection is based on road distance, not camera distance.
