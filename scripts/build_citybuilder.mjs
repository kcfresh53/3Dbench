import {build} from 'esbuild';

await build({
	entryPoints: ['plugins/citybuilder/plugin.ts'],
	bundle: true,
	format: 'iife',
	target: 'es2020',
	outfile: 'plugins/citybuilder.js',
	legalComments: 'none',
	// Node's own modules are provided by the Electron app at run time.
	external: ['node:fs', 'node:path'],

	banner: {js: '// City Builder for 3D Bench. Landscape, zoning, growing buildings and game-ready export.\n// Reuses Roadscape (GPL-3.0-or-later) and Procedural Trees. Load via File > Plugins > Load Plugin from File.\n'},
});
console.log('Built plugins/citybuilder.js');
