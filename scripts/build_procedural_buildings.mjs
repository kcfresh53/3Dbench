import {build} from 'esbuild';
import {access,readFile,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
try {await access('.local-assets/buildings/library.json');}catch {
 throw new Error('Import the supplied Blender kit first. See plugins/procedural_buildings/README.md.');
}
const packs={};
for(let style=1;style<=10;style++)packs[style]=gzipSync(await readFile(`.local-assets/flexibuilding/native/style${style}.json`),{level:9}).toString('base64');
await writeFile('.local-assets/flexibuilding/native/packs.json',JSON.stringify(packs));
await build({entryPoints:['plugins/procedural_buildings/plugin.js'],bundle:true,format:'iife',target:'es2020',outfile:'plugins/procedural_buildings.js',banner:{js:'// Procedural Buildings v5 for 3DBench. Native generation; no Blender runtime. Plugin code: GPL-3.0-or-later. Architecture and adapted artwork: Felipe Del Rio, supplied locally by the user.\n// Install via File > Plugins > Load Plugin from File.'}});
