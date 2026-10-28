import {build} from 'esbuild';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
// Bundles the TypeScript tests so they run on plain Node with no extra loader.
const dir = await mkdtemp(join(tmpdir(), 'roadscape-'));
const outfile = join(dir, 'roadscape.test.mjs');
try {
	await build({entryPoints: ['plugins/roadscape/tests/index.ts'], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'warning'});
	const result = spawnSync(process.execPath, ['--test', outfile], {stdio: 'inherit'});
	process.exitCode = result.status ?? 1;
} finally {
	await rm(dir, {recursive: true, force: true});
}
