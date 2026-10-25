# Procedural Trees for 3DBench

Game-ready trees and foliage with a live preview. Built into the 3DBench fork; also available as the standalone `plugins/procedural_trees.js` plugin. **Tools → Procedural Tree…** creates one; select a generated tree and use **Tools → Edit Procedural Tree…** to regenerate it (replaces the group's contents, undo restores them).

## Presets

Oak, pine, birch, bush, palm and dead tree, each as **Stylized** (original crossed leaf clusters, textured blobs and conifer tiers) and **Realistic** (more branches, 1024 px atlas, photographed CC0 bark and individually oriented transparent leaves and needle sprigs). Switching preset rewrites the shape fields but keeps your seed, LOD count, LOD layout, foliage-mesh option and texture slots.

For older trees, **Reset shape to preset** applies the revised proportions while preserving the seed, texture inputs and LOD settings. New dialogs start with realistic oak.

## Palms

**Palm · Realistic** and **Palm · Stylized** use a curved, ringed trunk with a crown of arched pinnate fronds and folded, tapered leaflets. Their bark and leaflet textures are procedural, with no extra image downloads. Existing tree presets are unchanged.

For palms, **Branches per level** controls frond count, **Length ratio** controls frond reach, **Gravity** controls droop, **Size** controls leaflet span relative to the frond, and **Density** controls the number of leaflet pairs. Trunk bend, taper, seed, colors, atlas size, separate foliage, triangle budgets and LODs work as usual. Branch generation levels and crown-shape fields do not apply to the dedicated palm crown.

## Game optimisation

- No end caps, branch bases buried in their parent, tips collapse to one vertex, rings share vertices
- Sides per tube drop with branch level; realistic branch paths stay fixed across budgets and LODs
- **Triangle budget**: the generator binary-searches a quality value that thins branches, foliage and sides until the tree fits
- Optional LOD1/LOD2 at 50% / 25% of the budget, sharing an origin for game-engine export. Enable **Spread LODs for editing** for a side-by-side layout; the preview always shows them side by side. Export individual LOD groups or configure an LOD group in your engine; automatic engine switching is not encoded in glTF.
- One atlas, one material. Foliage can be a separate mesh so bark is opaque and only leaves need alpha test

## UV layout

One square atlas: bark on the left half, the alpha leaf card top right, an opaque foliage field bottom right for stylized trees or blob/tier foliage. Realistic leaf-card presets leave that unused quarter transparent.

- Branch bark UVs follow the branch length-to-circumference ratio, so trunks keep square texels and twigs stretch the vertical streaks. Each branch samples a different stretch of bark.
- Blob and cone-tier foliage is projected flat per face into a window of the foliage field (one uniform scale, square texels), instead of sampling a few pixels.
- Regions are inset so mipmaps do not bleed.

## Texture slots

Realistic presets ship with offline CC0 Poly Haven photographs. Imported images override each slot and are saved with the tree for later regeneration. Disable **Photographic defaults** for procedural paint. See `textures/README.md` for provenance, limitations and Textures.com import guidance.

## Develop

```sh
npm run build:trees   # bundles plugins/procedural_trees.js
npm run test:trees    # budgets, UV regions, UV window size, determinism
npx tsc -p plugins/procedural_trees/tsconfig.json
npm run test:trees-visual # captures preset previews in .scratch/tree-review
npm run test:trees-scene # isolated Electron: preview, alpha/glTF export, project reload, undo and failure rollback
```

Layout: `src/core/` is pure generation (no editor dependency), `src/texture/` paints the atlas, `src/ui/` holds presets, the field table, the form adapter, the preview and the dialog, and `src/blockbench/bridge.ts` is the only file that creates meshes, textures and undo steps.

The atlas includes alpha: use alpha clipping (cutoff 0.5) and two-sided rendering for foliage in your engine. Normal/roughness maps, wind animation and billboards are not generated.
