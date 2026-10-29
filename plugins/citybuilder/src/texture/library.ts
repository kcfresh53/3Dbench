import { SURFACE_DATA } from './library_data';

/** Ids of the photographic maps shipped with the plugin (see tools/build_surface_library.py). */
export type PlateId =
	| 'brick_maps'
	| 'brick_normal'
	| 'brick_rough'
	| 'concrete_base'
	| 'concrete_normal'
	| 'concrete_rough'
	| 'grunge'
	| `shop_${number}`
	| `office_${number}`
	| `home_${number}`;

export type RoomKind = 'shop' | 'office' | 'home';
export const ROOMS_PER_KIND: number = 6;

/** A decoded image with `c` interleaved 8-bit channels. */
export interface Plate {
	w: number;
	h: number;
	c: number;
	data: Uint8Array;
}

interface ZlibLike {
	inflateSync(data: Uint8Array): Uint8Array;
}

function zlib(): ZlibLike {
	const proc = (globalThis as unknown as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
	const builtin: unknown = proc?.getBuiltinModule?.('node:zlib');
	if (builtin) return builtin as ZlibLike;
	return require('node:zlib') as ZlibLike;
}

const decoded: Map<string, Plate> = new Map<string, Plate>();

/** Decodes a stored map the first time it is asked for. */
export function plate(id: PlateId): Plate {
	let found: Plate | undefined = decoded.get(id);
	if (found) return found;
	const packed = SURFACE_DATA[id];
	if (!packed) throw new Error(`Unknown surface map ${id}`);
	const text: string = atob(packed.z);
	const bytes: Uint8Array = new Uint8Array(text.length);
	for (let i: number = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
	found = { w: packed.w, h: packed.h, c: packed.c, data: new Uint8Array(zlib().inflateSync(bytes)) };
	decoded.set(id, found);
	return found;
}

/** Bilinear sample into `out` (one value per channel, 0..255). `wrap` tiles the image, otherwise it clamps. */
export function sampleInto(p: Plate, u: number, v: number, wrap: boolean, out: Float64Array): void {
	const x: number = u * p.w - 0.5;
	const y: number = v * p.h - 0.5;
	const x0: number = Math.floor(x);
	const y0: number = Math.floor(y);
	const fx: number = x - x0;
	const fy: number = y - y0;
	const idx = (ix: number, iy: number): number => {
		const px: number = wrap ? ((ix % p.w) + p.w) % p.w : Math.min(p.w - 1, Math.max(0, ix));
		const py: number = wrap ? ((iy % p.h) + p.h) % p.h : Math.min(p.h - 1, Math.max(0, iy));
		return (py * p.w + px) * p.c;
	};
	const a: number = idx(x0, y0);
	const b: number = idx(x0 + 1, y0);
	const c: number = idx(x0, y0 + 1);
	const d: number = idx(x0 + 1, y0 + 1);
	for (let k: number = 0; k < p.c; k++) {
		const top: number = p.data[a + k] + (p.data[b + k] - p.data[a + k]) * fx;
		const bottom: number = p.data[c + k] + (p.data[d + k] - p.data[c + k]) * fx;
		out[k] = top + (bottom - top) * fy;
	}
}

/** Id of room number `index` of a kind. */
export function roomId(kind: RoomKind, index: number): PlateId {
	return `${kind}_${((index % ROOMS_PER_KIND) + ROOMS_PER_KIND) % ROOMS_PER_KIND}` as PlateId;
}
