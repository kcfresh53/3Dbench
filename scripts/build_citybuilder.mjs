import {build} from 'esbuild';
import {readFile,access} from 'node:fs/promises';

const manifest=JSON.parse(await readFile('plugins/citybuilder/src/texture/ambientcg_manifest.json','utf8'));
await Promise.all(Object.values(manifest).flatMap(m=>Object.values(m.maps).flatMap(file=>[
	access(`plugins/citybuilder/textures/pbr/${file}`),access(`plugins/citybuilder/textures/pbr/preview/${file}`),
])));
const cleanNotice=text=>text.replace(/\r\n/g,'\n').replace(/[ \t]+$/gm,'');
const jpegLicense=cleanNotice(await readFile('plugins/citybuilder/src/texture/vendor/jpeg-js.LICENSE','utf8'));
const apacheLicense=cleanNotice(await readFile('plugins/citybuilder/src/texture/vendor/Apache-2.0.txt','utf8'));

await build({
	entryPoints: ['plugins/citybuilder/plugin.ts'],
	bundle: true,
	format: 'iife',
	target: 'es2020',
	outfile: 'plugins/citybuilder.js',
	legalComments: 'none',
	// Node's own modules are provided by the Electron app at run time.
	external: ['node:fs', 'node:path', 'node:zlib'],

	banner: {js: '// City Builder for 3D Bench. Landscape, zoning, growing buildings and game-ready export.\n// Keep citybuilder/textures/pbr beside this plugin for offline 4K material export.\n// Reuses Roadscape (GPL-3.0-or-later) and Procedural Trees. Load via File > Plugins > Load Plugin from File.\n/* JPEG decoder: jpeg-js 0.4.4, Eugene Ware; original decoder Copyright 2011 notmasteryet.\n'+jpegLicense+'\n'+apacheLicense+'\n*/\n'},
});
console.log('Built plugins/citybuilder.js');
