import type { RoadLibrary } from '../core/library_types';

async function gunzip(bytes: Uint8Array): Promise<string> {
	const stream: ReadableStream<Uint8Array> = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')) as ReadableStream<Uint8Array>;
	return new Response(stream).text();
}

function fromBase64(text: string): Uint8Array {
	const binary: string = atob(text);
	const bytes: Uint8Array = new Uint8Array(binary.length);
	for (let i: number = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/** Unpacks the artwork bundled with the plugin: one atlas, material tiles and optimised props. */
export async function loadLibrary(packed: string): Promise<RoadLibrary> {
	return JSON.parse(await gunzip(fromBase64(packed))) as RoadLibrary;
}
