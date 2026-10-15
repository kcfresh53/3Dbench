// Shared helpers for the IK rig tests: bundles the TypeScript sources with esbuild and loads the real animation libraries.
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadModule(entry, name) {
	const dir = await mkdtemp(path.join(tmpdir(), '3dbench-ikrig-'));
	await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: path.join(dir, `${name}.mjs`), logLevel: 'error' });
	const module = await import(pathToFileURL(path.join(dir, `${name}.mjs`)));
	await rm(dir, { recursive: true, force: true });
	return module;
}
