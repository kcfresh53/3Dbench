import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { PropMesh } from '../src/core/types';
import type { MaterialTile, RoadLibrary } from '../src/core/library_types';
import { optimizeLibraryProps } from '../src/core/optimize/library_optimizer';

const SOURCE: string = process.env.ROADSCAPE_LIBRARY ?? '.local-assets/roadscape/library.json';
const CACHE: string = process.env.ROADSCAPE_PROP_CACHE ?? '/tmp/roadscape_props.json';

interface SourceLibrary {
	sourceVersion: string;
	sourceSha256: string;
	author: string;
	atlasSize: number;
	atlas: string;
	materials: Record<string, MaterialTile>;
	objects: Record<string, PropMesh>;
}

/** Loads the real artwork with props optimised once, exactly as the build step does. */
export function loadLibrary(withAtlas: boolean = false): RoadLibrary {
	const source: SourceLibrary = JSON.parse(readFileSync(SOURCE, 'utf8')) as SourceLibrary;
	let props: Record<string, PropMesh>;
	if (existsSync(CACHE)) props = JSON.parse(readFileSync(CACHE, 'utf8')) as Record<string, PropMesh>;
	else {
		props = optimizeLibraryProps(source.objects).props;
		writeFileSync(CACHE, JSON.stringify(props));
	}
	return {
		sourceVersion: source.sourceVersion,
		sourceSha256: source.sourceSha256,
		author: source.author,
		atlasSize: source.atlasSize,
		atlas: withAtlas ? source.atlas : '',
		materials: source.materials,
		props,
	};
}
