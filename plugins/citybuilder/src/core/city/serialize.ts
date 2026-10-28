import { ByteGrid } from '../grid';
import { DistrictMap } from '../district/map';
import { Heightfield } from '../terrain/heightfield';
import { mergeSettings } from './settings';
import type { CitySettings } from './settings';
import { CityState } from './state';

export const SAVE_VERSION: number = 1;

/** Heights are stored as millimetre integers, delta coded: exact enough and compact. */
const HEIGHT_SCALE: number = 1000;

interface SavedCity {
	version: number;
	settings: Partial<CitySettings>;
	heights: string;
	paint: string;
	districts: string;
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary: string = '';
	for (let i: number = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
	const binary: string = atob(text);
	const out: Uint8Array = new Uint8Array(binary.length);
	for (let i: number = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
	return out;
}

/** Run-length encoding: pairs of (count 1..255, value). Zoning and paint come in large flat areas. */
export function rleEncode(data: Uint8Array): Uint8Array {
	const out: number[] = [];
	let i: number = 0;
	while (i < data.length) {
		const value: number = data[i];
		let run: number = 1;
		while (i + run < data.length && data[i + run] === value && run < 255) run++;
		out.push(run, value);
		i += run;
	}
	return Uint8Array.from(out);
}

export function rleDecode(encoded: Uint8Array, length: number): Uint8Array {
	const out: Uint8Array = new Uint8Array(length);
	let at: number = 0;
	for (let i: number = 0; i + 1 < encoded.length && at < length; i += 2) {
		const run: number = Math.min(encoded[i], length - at);
		out.fill(encoded[i + 1], at, at + run);
		at += run;
	}
	return out;
}

function encodeHeights(hf: Heightfield): string {
	const ints: Int32Array = new Int32Array(hf.heights.length);
	// Delta against the previous vertex keeps values small, which compresses well under base64 + JSON.
	let previous: number = 0;
	for (let i: number = 0; i < ints.length; i++) {
		const q: number = Math.round(hf.heights[i] * HEIGHT_SCALE);
		ints[i] = q - previous;
		previous = q;
	}
	return bytesToBase64(new Uint8Array(ints.buffer));
}

function decodeHeights(text: string, count: number): Float32Array {
	const bytes: Uint8Array = base64ToBytes(text);
	const ints: Int32Array = new Int32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
	const out: Float32Array = new Float32Array(count);
	let running: number = 0;
	for (let i: number = 0; i < count && i < ints.length; i++) {
		running += ints[i];
		out[i] = running / HEIGHT_SCALE;
	}
	return out;
}

export function serializeCity(state: CityState): string {
	const saved: SavedCity = {
		version: SAVE_VERSION,
		settings: state.settings,
		heights: encodeHeights(state.terrain),
		paint: bytesToBase64(rleEncode(state.paint.data)),
		districts: bytesToBase64(rleEncode(state.districts.grid.data)),
	};
	return JSON.stringify(saved);
}

/** Returns null when the text is not a city this version understands. */
export function deserializeCity(text: string): CityState | null {
	let saved: SavedCity;
	try {
		saved = JSON.parse(text) as SavedCity;
	} catch {
		return null;
	}
	if (typeof saved !== 'object' || saved === null || saved.version !== SAVE_VERSION) return null;
	const settings: CitySettings = mergeSettings(saved.settings);
	const terrain: Heightfield = new Heightfield({ cols: settings.cols, rows: settings.rows, cellSize: settings.cellSize }, decodeHeights(saved.heights, settings.cols * settings.rows));
	const cells: number = terrain.cellCols * terrain.cellRows;
	const paint: ByteGrid = ByteGrid.from(terrain.cellCols, terrain.cellRows, rleDecode(base64ToBytes(saved.paint), cells));
	const districts: DistrictMap = new DistrictMap(terrain, ByteGrid.from(terrain.cellCols, terrain.cellRows, rleDecode(base64ToBytes(saved.districts), cells)));
	return new CityState(settings, terrain, paint, districts);
}
