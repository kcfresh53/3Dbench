import type { PackageFile } from '../core/gameready/package';
import type { Raster } from '../core/raster';
import { dataRasterPng } from '../core/raster_png';

interface NodeFs {
	mkdirSync(path: string, options: { recursive: boolean }): void;
	writeFileSync(path: string, data: Uint8Array | string): void;
	readFileSync(path: string): Uint8Array;
	accessSync(path: string): void;
}

interface NodePath {
	join(...parts: string[]): string;
	dirname(path: string): string;
}

function canvasOf(raster: Raster): HTMLCanvasElement {
	const canvas: HTMLCanvasElement = document.createElement('canvas');
	canvas.width = raster.width;
	canvas.height = raster.height;
	const context: CanvasRenderingContext2D = canvas.getContext('2d') as CanvasRenderingContext2D;
	context.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0);
	return canvas;
}

export function rasterToDataUrl(raster: Raster): string {
	return canvasOf(raster).toDataURL('image/png');
}

export function rasterToPng(raster: Raster): Promise<Uint8Array> {
	return new Promise<Uint8Array>((resolve, reject): void => {
		canvasOf(raster).toBlob((blob: Blob | null): void => {
			if (!blob) {
				reject(new Error('Could not encode a PNG.'));
				return;
			}
			void blob.arrayBuffer().then((buffer: ArrayBuffer): void => resolve(new Uint8Array(buffer)), reject);
		}, 'image/png');
	});
}

/** Writes the files below `directory`, creating folders as needed. Desktop app only. */
export async function writePackage(directory: string, files: PackageFile[]): Promise<number> {
	if (typeof require !== 'function') throw new Error('Exporting to a folder needs the desktop app.');
	const fs: NodeFs = require('node:fs') as NodeFs;
	const path: NodePath = require('node:path') as NodePath;
	// Validate the separate resource pack before writing any part of the destination package.
	for (const file of files) if (file.source) fs.accessSync(file.source);
	let written: number = 0;
	for (const file of files) {
		const target: string = path.join(directory, ...file.path.split('/'));
		fs.mkdirSync(path.dirname(target), { recursive: true });
		if (file.text !== undefined) fs.writeFileSync(target, file.text);
		else if (file.bytes) fs.writeFileSync(target, file.bytes);
		else if (file.source) fs.writeFileSync(target, fs.readFileSync(file.source));
		else if (file.raster) fs.writeFileSync(target, file.dataTexture ? dataRasterPng(file.raster) : await rasterToPng(file.raster));
		else continue;
		written++;
	}
	return written;
}
