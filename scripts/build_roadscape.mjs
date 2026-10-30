import {access, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';

const SOURCE = '.local-assets/roadscape/library.json';
const PACKED = 'plugins/roadscape/assets/packed_library.ts';
const exists = async (path) => access(path).then(() => true, () => false);

// 1. Optimise the source artwork into the packed library when the source is present.
//    Clean checkouts reuse the tracked packed library.
if (!process.argv.includes('--skip-assets') && await exists(SOURCE)) {
	const dir = await mkdtemp(join(tmpdir(), 'roadscape-pack-'));
	try {
		const tool = join(dir, 'pack_library.cjs');
		await build({entryPoints: ['plugins/roadscape/tools/pack_library.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: tool, logLevel: 'warning'});
		const run = spawnSync(process.execPath, [tool, SOURCE, PACKED, 'plugins/roadscape/assets/prop_report.json'], {stdio: 'inherit'});
		if (run.status !== 0) throw new Error('Optimising the Roadscape props failed.');
	} finally {
		await rm(dir, {recursive: true, force: true});
	}
} else if (!(await exists(PACKED))) {
	throw new Error(`Missing ${PACKED}. Provide ${SOURCE} to generate it.`);
}

// 2. Bundle the plugin. The tree generator is reused, but its photographic textures are not needed
//    for road-side trees, so they are replaced by an empty stand-in to keep the plugin small.
const withoutPhotos = {
	name: 'no-bundled-photos',
	setup(b) {
		b.onResolve({filter: /\/bundled$/}, () => ({path: 'bundled-stub', namespace: 'stub'}));
		b.onLoad({filter: /.*/, namespace: 'stub'}, () => ({contents: "export const BUNDLED_TEXTURES = {bark: '', pineBark: '', leaf: '', needle: ''};", loader: 'js'}));
	},
};
await build({
	entryPoints: ['plugins/roadscape/plugin.ts'],
	bundle: true,
	format: 'iife',
	target: 'es2020',
	outfile: 'plugins/roadscape.js',
	legalComments: 'none',
	external: ['node:fs'],
	plugins: [withoutPhotos],
	banner: {js: '// Roadscape v3 for 3D Bench. Standalone road-network plugin; GPL-3.0-or-later.\n// Source artwork: Baptiste Mollicone and SLX, Roadscape 4.13.10. Adapted 2026-10-28.\n// Load via File > Plugins > Load Plugin from File. License and scope: plugins/roadscape/README.md\n'},
});
console.log('Built plugins/roadscape.js');
