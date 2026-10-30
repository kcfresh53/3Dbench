import { sampleMaterial } from './ambientcg';
import type { MaterialId } from './ambientcg';
import type { Palette, TileKind } from '../core/buildings/tiles';
import { fbm, hash2 } from '../core/math';
import type { Rgb } from '../core/raster';
import { plate, roomId, ROOMS_PER_KIND, sampleInto } from './library';
import type { Plate, RoomKind } from './library';
import { boxDistance, coverage, layer, occlude, resetTexel } from './surface';
import type { Texel } from './surface';

/**
 * What a painter knows about the surface it is painting. Everything is in metres, measured from the top-left of the
 * tile, so details such as bricks, mullions and railings keep their real size on a wall of any dimensions.
 */
export interface TileCtx {
	p: Palette;
	/** World size of the tile. */
	mw: number;
	mh: number;
	/** Metres per pixel. */
	pixel: number;
	/** Varies the little things (blinds, pane tilt) from one window to the next. */
	seed: number;
}

export type TilePainter = (c: TileCtx, t: Texel, x: number, y: number) => void;

const scratch: Texel = { r: 0, g: 0, b: 0, roughness: 0, metallic: 0, ao: 1, height: 0, slopeX: 0, slopeY: 0 };

/** A reusable copy of a texel, so painting a pane does not allocate per pixel. */
function scratchOf(t: Texel): Texel {
	scratch.r = t.r;
	scratch.g = t.g;
	scratch.b = t.b;
	scratch.roughness = t.roughness;
	scratch.metallic = t.metallic;
	scratch.ao = t.ao;
	scratch.height = t.height;
	scratch.slopeX = t.slopeX;
	scratch.slopeY = t.slopeY;
	return scratch;
}

const mul = (c: Rgb, f: number): Rgb => [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const FABRICS: Rgb[] = [[206, 196, 176], [168, 174, 184], [128, 110, 100], [222, 218, 208]];
const ALUMINIUM: Rgb = [176, 180, 184];

function rect(c: TileCtx, x: number, y: number, x0: number, y0: number, x1: number, y1: number, grow: number = 0): number {
	return coverage(boxDistance(x, y, x0, y0, x1, y1) - grow, c.pixel);
}

const tmp: Float64Array = new Float64Array(4);

/** Weathering: streaks that run down the wall, from the shipped grunge map. */
function weather(c: TileCtx, t: Texel, x: number, y: number, amount: number): void {
	sampleInto(plate('grunge'), x / 6 + c.seed * 0.37, y / 14 + c.seed * 0.11, true, tmp);
	const dirt: number = 1 - amount * (1 - tmp[0] / 255);
	t.r *= dirt;
	t.g *= dirt;
	t.b *= dirt;
}

/** Rendered concrete or plaster: a photographic concrete map tinted to the palette's wall colour. */
function photographic(t: Texel, id: MaterialId, x: number, y: number, tint: Rgb = [255,255,255], pixel: number = 0): void {
 sampleMaterial(id, 'albedo', x, y, tmp, pixel);
 resetTexel(t, [tmp[0]*tint[0]/255,tmp[1]*tint[1]/255,tmp[2]*tint[2]/255], .9, 0);
 sampleMaterial(id, 'orm', x, y, tmp, pixel);
 t.ao=tmp[0]/255; t.roughness=tmp[1]/255; t.metallic=tmp[2]/255;
 sampleMaterial(id, 'normal', x, y, tmp, pixel);
 const nz=Math.max(.2, tmp[2]/127.5-1);
 t.slopeX=(tmp[0]/127.5-1)/nz; t.slopeY=(tmp[1]/127.5-1)/nz;
}

function plaster(c: TileCtx, t: Texel, x: number, y: number, base: Rgb): void {
 photographic(t, 'plaster', x+c.seed*.173, y+c.seed*.071, base, c.pixel);
 weather(c,t,x,y,.08);
}

/** Slightly darker line along the bottom of a storey where the render meets the next floor. */
function floorLine(c: TileCtx, t: Texel, y: number): void {
	const d: number = c.mh - y;
	occlude(t, 0.22 * Math.max(0, 1 - d / 0.18));
}

interface Pane {
	/** 0..1 across and down the pane. */
	u: number;
	v: number;
	/** Pane size in metres. */
	w: number;
	h: number;
	id: number;
	/** Position inside the whole window (all its panes) and its size, which the room behind is cropped to. */
	wu: number;
	wv: number;
	ww: number;
	wh: number;
	/** One id per window, so a window shows a single room. */
	win: number;
}

/** How a pane of glass looks: what it shows behind it and how mirror-like it is. */
interface GlassLook {
	room: RoomKind;
	/** Chance that a clear pane shows a lit room rather than only reflecting. */
	share: number;
	/** Metallic value of a pane that only reflects (a coated mirror finish). */
	mirrorMetal: number;
	/** Metallic value of a pane that shows a room: a little metal keeps a strong reflection over it. */
	roomMetal: number;
}

const HOME_GLASS: GlassLook = { room: 'home', share: 1, mirrorMetal: 0.85, roomMetal: 0.12 };
const OFFICE_GLASS: GlassLook = { room: 'office', share: 1, mirrorMetal: 0.85, roomMetal: 0.12 };
const SHOP_GLASS: GlassLook = { room: 'shop', share: 1, mirrorMetal: 0.85, roomMetal: 0.1 };
const TOWER_GLASS: GlassLook = { room: 'office', share: 0, mirrorMetal: 0.92, roomMetal: 0.4 };

/** A lit room behind the pane, cropped to the pane's proportions. */
function roomBehind(c: TileCtx, pane: Pane, look: GlassLook, out: Rgb): void {
	const card: Plate = plate(roomId(look.room, Math.floor(hash2(pane.win, c.seed, 90) * ROOMS_PER_KIND)));
	const aspect: number = pane.ww / pane.wh;
	const us: number = aspect < 1 ? aspect : 1;
	const vs: number = aspect < 1 ? 1 : 1 / aspect;
	const flip: number = hash2(pane.win, c.seed, 91) < 0.5 ? -1 : 1;
	sampleInto(card, 0.5 + (pane.wu - 0.5) * us * flip, 0.5 + (pane.wv - 0.5) * vs, false, tmp);
	out[0] = tmp[0];
	out[1] = tmp[1];
	out[2] = tmp[2];
}

const roomColor: Rgb = [0, 0, 0];

/**
 * Window glass: sky-reflecting glazing, most panes with a lit room behind them, some with blinds or curtains drawn,
 * every pane tilted a hair so reflections break up across a facade.
 */
function glass(c: TileCtx, t: Texel, pane: Pane, tint: number, look: GlassLook): void {
	const r: number = hash2(pane.id, c.seed, 77);
	const tilt: number = (hash2(pane.id, c.seed, 78) - 0.5) * 0.05;
	const tiltY: number = (hash2(pane.id, c.seed, 79) - 0.5) * 0.05;
	const shade: number = 0.88 + hash2(pane.id, c.seed, 80) * 0.2;
	const mirror: Rgb = mul(c.p.glass, tint * shade * (1.15 - pane.v * 0.3));
	const rough: number = 0.04 + hash2(pane.id, c.seed, 81) * 0.05;
	layer(t, 1, mirror, rough, look.mirrorMetal, 0);
	t.height = tilt * (pane.u - 0.5) * pane.w + tiltY * (pane.v - 0.5) * pane.h;
	if (r < 0.6) {
		if (hash2(pane.id, c.seed, 85) < look.share) {
			roomBehind(c, pane, look, roomColor);
			const lit: Rgb = mix(mul(roomColor, 0.9), mirror, 0.12);
			layer(t, 1, lit, rough, look.roomMetal, t.height);
		}
	} else if (r < 0.8) {
		// A blind lowered part of the way down: pale slats that catch light, not mirror.
		const drop: number = 0.25 + hash2(pane.id, c.seed, 82) * 0.65;
		const inBlind: number = coverage((pane.v - drop) * pane.h, c.pixel);
		const slat: number = 0.5 + 0.5 * Math.cos((pane.v * pane.h * Math.PI * 2) / 0.035);
		const hold: number = 1 - inBlind;
		if (hash2(pane.id, c.seed, 86) < look.share) {
			roomBehind(c, pane, look, roomColor);
			layer(t, hold, mix(mul(roomColor, 0.9), mirror, 0.12), rough, look.roomMetal, t.height);
		}
		layer(t, inBlind, mix([214, 206, 190], [236, 230, 216], slat), 0.8, 0);
		occlude(t, inBlind * 0.1);
	} else if (r < 0.92) {
		// A curtain gathered to one side.
		const side: number = hash2(pane.id, c.seed, 83) < 0.5 ? pane.u : 1 - pane.u;
		const cloth: number = coverage((side - 0.3) * pane.w, c.pixel);
		const fold: number = 0.5 + 0.5 * Math.cos((pane.u * pane.w * Math.PI * 2) / 0.09);
		layer(t, 1 - cloth, mix(FABRICS[Math.floor(hash2(pane.id, c.seed, 84) * FABRICS.length)], [255, 255, 255], fold * 0.12), 0.95, 0, 0.004 * fold);
	} else {
		layer(t, 1, mul(c.p.glass, 0.18), 0.12, 0.4);
	}
}

interface WindowSpec {
	/** Opening as fractions of the tile. */
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	cols: number;
	rows: number;
	sill: boolean;
	look: GlassLook;
	/** Distinguishes windows in one tile. */
	id: number;
}

/** A recessed, framed window with a stone sill. */
function windowUnit(c: TileCtx, t: Texel, x: number, y: number, w: WindowSpec): void {
	const ox0: number = w.x0 * c.mw;
	const oy0: number = w.y0 * c.mh;
	const ox1: number = w.x1 * c.mw;
	const oy1: number = w.y1 * c.mh;
	const dOut: number = boxDistance(x, y, ox0, oy0, ox1, oy1);
	// Soft shadow in the reveal around the opening, deepest at the top.
	occlude(t, 0.4 * Math.max(0, 1 - dOut / 0.12) * (y < (oy0 + oy1) / 2 ? 1 : 0.6));
	if (w.sill) {
		const sill: number = rect(c, x, y, ox0 - 0.07, oy1, ox1 + 0.07, oy1 + 0.07);
		layer(t, sill, mul(c.p.trim, 1), 0.6, 0, 0.035);
		occlude(t, rect(c, x, y, ox0 - 0.07, oy1 + 0.07, ox1 + 0.07, oy1 + 0.2) * 0.18);
	}
	const inside: number = coverage(dOut, c.pixel);
	layer(t, inside, mul(c.p.frame, 1), 0.5, 0.1, -0.09);
	if (inside <= 0) return;
	const fw: number = 0.055;
	const gx0: number = ox0 + fw;
	const gx1: number = ox1 - fw;
	const gy0: number = oy0 + fw;
	const gy1: number = oy1 - fw;
	const paneW: number = (gx1 - gx0) / w.cols;
	const paneH: number = (gy1 - gy0) / w.rows;
	const pane: number = rect(c, x, y, gx0, gy0, gx1, gy1);
	if (pane > 0) {
		const col: number = Math.min(w.cols - 1, Math.max(0, Math.floor((x - gx0) / paneW)));
		const row: number = Math.min(w.rows - 1, Math.max(0, Math.floor((y - gy0) / paneH)));
		const local: Texel = scratchOf(t);
		glass(c, local, { u: (x - gx0 - col * paneW) / paneW, v: (y - gy0 - row * paneH) / paneH, w: paneW, h: paneH, id: col + row * 7, wu: (x - gx0) / (gx1 - gx0), wv: (y - gy0) / (gy1 - gy0), ww: gx1 - gx0, wh: gy1 - gy0, win: w.id }, 1.1, w.look);
		local.height = -0.1 + local.height;
		layer(t, pane, [local.r, local.g, local.b], local.roughness, local.metallic, local.height);
		t.ao = t.ao * (1 - pane) + local.ao * pane;
	}
	const bar: number = 0.028;
	for (let i: number = 1; i < w.cols; i++) {
		const bx: number = gx0 + i * paneW;
		layer(t, rect(c, x, y, bx - bar, gy0, bx + bar, gy1), c.p.frame, 0.5, 0.1, -0.06);
	}
	for (let i: number = 1; i < w.rows; i++) {
		const by: number = gy0 + i * paneH;
		layer(t, rect(c, x, y, gx0, by - bar, gx1, by + bar), c.p.frame, 0.5, 0.1, -0.06);
	}
}

/** Brickwork from the shipped brick maps: per-brick tone, mortar mask, grain, roughness and normals. */
function brick(c: TileCtx, t: Texel, x: number, y: number): void {
 photographic(t,'brick',x,y,[255,255,255],c.pixel);
 weather(c,t,x,y,.06);
}

function standingSeam(c: TileCtx, t: Texel, x: number, y: number, base: Rgb, metal: number): void {
	const spacing: number = 0.32;
	const d: number = Math.abs(((x / spacing) % 1 + 1) % 1 - 0.5) * spacing;
	const seam: number = coverage(d - (spacing / 2 - 0.012), c.pixel);
	const streak: number = fbm(x * 40, y * 1.5, c.seed + 6, 2);
	resetTexel(t, mul(base, 0.9 + streak * 0.18), 0.42 + streak * 0.14, metal);
	layer(t, seam, mul(base, 1.18), 0.34, metal, 0.014);
}

const painters: Record<TileKind, TilePainter> = {
	facade_a(c,t,x,y): void { photographic(t,'facade_a',x,y,[255,255,255],c.pixel); },
	facade_b(c,t,x,y): void { photographic(t,'facade_b',x,y,[255,255,255],c.pixel); },
	wall(c, t, x, y): void {
		plaster(c, t, x, y, c.p.wall);
		floorLine(c, t, y);
	},
	brick(c, t, x, y): void {
		brick(c, t, x, y);
		floorLine(c, t, y);
	},
	window(c, t, x, y): void {
		plaster(c, t, x, y, c.p.wall);
		windowUnit(c, t, x, y, { x0: 0.27, y0: 0.2, x1: 0.73, y1: 0.78, cols: 2, rows: 2, sill: true, look: HOME_GLASS, id: 0 });
		floorLine(c, t, y);
	},
	window_wide(c, t, x, y): void {
		plaster(c, t, x, y, c.p.wall);
		windowUnit(c, t, x, y, { x0: 0.12, y0: 0.26, x1: 0.88, y1: 0.74, cols: 3, rows: 1, sill: true, look: OFFICE_GLASS, id: 0 });
		floorLine(c, t, y);
	},
	window_pair(c, t, x, y): void {
		plaster(c, t, x, y, c.p.wall);
		windowUnit(c, t, x, y, { x0: 0.12, y0: 0.2, x1: 0.46, y1: 0.78, cols: 1, rows: 2, sill: true, look: HOME_GLASS, id: 1 });
		windowUnit(c, t, x, y, { x0: 0.54, y0: 0.2, x1: 0.88, y1: 0.78, cols: 1, rows: 2, sill: true, look: HOME_GLASS, id: 2 });
		floorLine(c, t, y);
	},
	balcony(c, t, x, y): void {
		plaster(c, t, x, y, c.p.wall);
		windowUnit(c, t, x, y, { x0: 0.27, y0: 0.08, x1: 0.73, y1: 0.62, cols: 2, rows: 1, sill: false, look: HOME_GLASS, id: 0 });
		const slabY: number = c.mh * 0.66;
		const slab: number = rect(c, x, y, 0.02 * c.mw, slabY, 0.98 * c.mw, slabY + 0.14);
		occlude(t, rect(c, x, y, 0.02 * c.mw, slabY - 0.4, 0.98 * c.mw, slabY) * 0.25);
		layer(t, slab, mul(c.p.trim, 0.92), 0.7, 0, 0.12);
		const railTop: number = slabY + 0.14;
		const railBottom: number = c.mh - 0.02;
		const barPitch: number = 0.13;
		const bar: number = Math.abs(((x / barPitch) % 1 + 1) % 1 - 0.5) * barPitch;
		const barCover: number = coverage(bar - 0.009, c.pixel) * rect(c, x, y, 0.04 * c.mw, railTop, 0.96 * c.mw, railBottom);
		const round: number = Math.sqrt(Math.max(0, 1 - (bar / 0.009) ** 2));
		occlude(t, rect(c, x, y, 0.02 * c.mw, railTop, 0.98 * c.mw, railBottom) * 0.35);
		layer(t, barCover, c.p.frame, 0.45, 0.8, 0.02 * round + 0.06);
		layer(t, rect(c, x, y, 0.03 * c.mw, railBottom - 0.04, 0.97 * c.mw, railBottom), c.p.frame, 0.45, 0.8, 0.08);
		layer(t, rect(c, x, y, 0.03 * c.mw, railTop, 0.97 * c.mw, railTop + 0.04), c.p.frame, 0.45, 0.8, 0.08);
	},
	shop_glass(c, t, x, y): void {
		resetTexel(t, mul(c.p.frame, 1.1), 0.5, 0.3);
		const gx0: number = 0.04 * c.mw;
		const gx1: number = 0.96 * c.mw;
		const gy0: number = 0.14 * c.mh;
		const gy1: number = 0.82 * c.mh;
		const pane: number = rect(c, x, y, gx0, gy0, gx1, gy1);
		if (pane > 0) {
			const local: Texel = scratchOf(t);
			const half: number = (gx1 - gx0) / 2;
			const left: boolean = x < gx0 + half;
			glass(c, local, { u: ((x - gx0) % half) / half, v: (y - gy0) / (gy1 - gy0), w: half, h: gy1 - gy0, id: left ? 1 : 2, wu: (x - gx0) / (gx1 - gx0), wv: (y - gy0) / (gy1 - gy0), ww: gx1 - gx0, wh: gy1 - gy0, win: 5 }, 1.1, SHOP_GLASS);
			layer(t, pane, [local.r, local.g, local.b], local.roughness, local.metallic, -0.05 + local.height);
		}
		layer(t, rect(c, x, y, gx0 + (gx1 - gx0) / 2 - 0.03, gy0, gx0 + (gx1 - gx0) / 2 + 0.03, gy1), c.p.frame, 0.45, 0.6, 0.02);
		layer(t, rect(c, x, y, 0, 0, c.mw, 0.12 * c.mh), c.p.trim, 0.6, 0, 0.06);
		layer(t, rect(c, x, y, 0, 0.84 * c.mh, c.mw, c.mh), mul(c.p.wall, 0.7), 0.8, 0, 0.0);
	},
	shop_door(c, t, x, y): void {
		resetTexel(t, mul(c.p.frame, 1.1), 0.5, 0.3);
		layer(t, rect(c, x, y, 0.2 * c.mw, 0.14 * c.mh, 0.8 * c.mw, c.mh), c.p.accent, 0.55, 0.1, -0.04);
		const gx0: number = 0.28 * c.mw;
		const gx1: number = 0.72 * c.mw;
		const gy0: number = 0.22 * c.mh;
		const gy1: number = 0.68 * c.mh;
		const pane: number = rect(c, x, y, gx0, gy0, gx1, gy1);
		if (pane > 0) {
			const local: Texel = scratchOf(t);
			glass(c, local, { u: (x - gx0) / (gx1 - gx0), v: (y - gy0) / (gy1 - gy0), w: gx1 - gx0, h: gy1 - gy0, id: 3, wu: (x - gx0) / (gx1 - gx0), wv: (y - gy0) / (gy1 - gy0), ww: gx1 - gx0, wh: gy1 - gy0, win: 6 }, 1.1, SHOP_GLASS);
			layer(t, pane, [local.r, local.g, local.b], local.roughness, local.metallic, -0.06);
		}
		layer(t, rect(c, x, y, 0.66 * c.mw, 0.72 * c.mh, 0.7 * c.mw, 0.8 * c.mh), ALUMINIUM, 0.3, 1, 0.05);
		layer(t, rect(c, x, y, 0, 0, c.mw, 0.12 * c.mh), c.p.trim, 0.6, 0, 0.06);
	},
	door(c, t, x, y): void {
		plaster(c, t, x, y, c.p.wall);
		const d0: number = 0.3 * c.mw;
		const d1: number = 0.7 * c.mw;
		const top: number = 0.2 * c.mh;
		occlude(t, 0.4 * Math.max(0, 1 - boxDistance(x, y, d0, top, d1, c.mh) / 0.12));
		layer(t, rect(c, x, y, d0 - 0.1, top - 0.12, d1 + 0.1, top), c.p.trim, 0.6, 0, 0.04);
		layer(t, rect(c, x, y, d0, top, d1, c.mh), c.p.frame, 0.5, 0.05, -0.07);
		const leaf: number = rect(c, x, y, d0 + 0.05, top + 0.05, d1 - 0.05, c.mh);
		layer(t, leaf, c.p.accent, 0.5, 0.05, -0.05);
		const panelW: number = (d1 - d0 - 0.2) / 2;
		const panelH: number = (c.mh - top - 0.3) / 2;
		for (let i: number = 0; i < 2; i++) {
			for (let j: number = 0; j < 2; j++) {
				const px0: number = d0 + 0.1 + i * (panelW + 0.1);
				const py0: number = top + 0.12 + j * (panelH + 0.08);
				const inner: number = rect(c, x, y, px0, py0, px0 + panelW - 0.02, py0 + panelH);
				layer(t, inner, mul(c.p.accent, 0.88), 0.55, 0.05, -0.035);
			}
		}
		layer(t, rect(c, x, y, d1 - 0.14, top + (c.mh - top) * 0.5 - 0.04, d1 - 0.09, top + (c.mh - top) * 0.5 + 0.06), ALUMINIUM, 0.3, 1, -0.02);
		layer(t, rect(c, x, y, d0 - 0.15, c.mh - 0.06, d1 + 0.15, c.mh), mul(c.p.trim, 0.8), 0.7, 0, 0.04);
	},
	garage(c, t, x, y): void {
		plaster(c, t, x, y, mul(c.p.wall, 0.95));
		const g: number = rect(c, x, y, 0.1 * c.mw, 0.2 * c.mh, 0.9 * c.mw, c.mh);
		occlude(t, 0.35 * Math.max(0, 1 - boxDistance(x, y, 0.1 * c.mw, 0.2 * c.mh, 0.9 * c.mw, c.mh) / 0.1));
		layer(t, g, mul(c.p.trim, 0.9), 0.5, 0.7, -0.06);
		const panelH: number = (c.mh * 0.8) / 4;
		const k: number = ((y - 0.2 * c.mh) / panelH) % 1;
		const groove: number = g * coverage(Math.min(k, 1 - k) * panelH - 0.015, c.pixel);
		layer(t, groove, mul(c.p.trim, 0.55), 0.6, 0.7, -0.1);
		const row: number = rect(c, x, y, 0.16 * c.mw, 0.24 * c.mh, 0.84 * c.mw, 0.24 * c.mh + 0.2);
		layer(t, row, mul(c.p.glass, 0.4), 0.1, 0.5, -0.1);
	},
	panel(c, t, x, y): void {
		standingSeam(c, t, x, y, c.p.wall, 0.25);
		floorLine(c, t, y);
	},
	panel_high(c, t, x, y): void {
		standingSeam(c, t, x, y, c.p.wall, 0.25);
		const gx0: number = 0.05 * c.mw;
		const gx1: number = 0.95 * c.mw;
		const gy0: number = 0.12 * c.mh;
		const gy1: number = 0.34 * c.mh;
		layer(t, rect(c, x, y, gx0 - 0.04, gy0 - 0.04, gx1 + 0.04, gy1 + 0.04), c.p.frame, 0.45, 0.5, 0.02);
		const pane: number = rect(c, x, y, gx0, gy0, gx1, gy1);
		if (pane > 0) {
			const n: number = 3;
			const w: number = (gx1 - gx0) / n;
			const col: number = Math.min(n - 1, Math.floor((x - gx0) / w));
			const local: Texel = scratchOf(t);
			glass(c, local, { u: (x - gx0 - col * w) / w, v: (y - gy0) / (gy1 - gy0), w, h: gy1 - gy0, id: col + 11, wu: (x - gx0) / (gx1 - gx0), wv: (y - gy0) / (gy1 - gy0), ww: gx1 - gx0, wh: gy1 - gy0, win: 7 }, 0.9, OFFICE_GLASS);
			layer(t, pane, [local.r, local.g, local.b], local.roughness, local.metallic, -0.02 + local.height);
		}
		floorLine(c, t, y);
	},
	glass_tower(c,t,x,y): void {
		glass(c,t,{u:x/c.mw,v:y/c.mh,w:c.mw,h:c.mh,id:3,wu:x/c.mw,wv:y/c.mh,ww:c.mw,wh:c.mh,win:20},1.15,TOWER_GLASS);
	},
	glass_room(c,t,x,y): void {
		glass(c,t,{u:x/c.mw,v:y/c.mh,w:c.mw,h:c.mh,id:3,wu:x/c.mw,wv:y/c.mh,ww:c.mw,wh:c.mh,win:20},1,HOME_GLASS);
	},
	curtain(c, t, x, y): void {
		// A glass skin: thin mullions, a slim opaque spandrel at each slab, deep reflective panes with a vertical gradient.
		const cols: number = Math.max(1, Math.round(c.mw / 1.35));
		const colW: number = c.mw / cols;
		const spandrelTop: number = c.mh * 0.86;
		const col: number = Math.min(cols - 1, Math.floor(x / colW));
		const lx: number = x - col * colW;
		const inSpandrel: number = coverage(spandrelTop - y, c.pixel);
		const local: Texel = scratchOf(t);
		glass(c, local, { u: lx / colW, v: Math.min(1, y / spandrelTop), w: colW, h: spandrelTop, id: col + 3, wu: lx / colW, wv: Math.min(1, y / spandrelTop), ww: colW, wh: spandrelTop, win: col + 20 }, 1.15, TOWER_GLASS);
		resetTexel(t, [local.r, local.g, local.b], local.roughness, local.metallic);
		t.height = local.height - 0.02;
		t.ao = local.ao;
		const frit: number = 0.5 + 0.5 * fbm(x * 30, y * 30, c.seed + 8, 2);
		layer(t, inSpandrel, mix(mul(c.p.glass, 0.55), mul(c.p.frame, 0.5), 0.5 + frit * 0.1), 0.25, 0.6, -0.02);
		const half: number = 0.022;
		const mx: number = Math.min(lx, colW - lx);
		const mull: number = coverage(mx - half, c.pixel);
		const frame: Rgb = mix(c.p.frame, ALUMINIUM, 0.5);
		layer(t, mull, frame, 0.32, 1, 0.02);
		const topBar: number = coverage(y - 0.03, c.pixel);
		const botBar: number = coverage(c.mh - y - 0.03, c.pixel);
		layer(t, topBar, frame, 0.32, 1, 0.02);
		layer(t, botBar, frame, 0.32, 1, 0.02);
	},
	curtain_band(c, t, x, y): void {
		// A plant floor behind louvred aluminium: horizontal slats with dark slots between them.
		const streak: number = fbm(x * 30, y * 2, c.seed + 6, 2);
		resetTexel(t, mul(mix(c.p.trim, ALUMINIUM, 0.85), 0.9 + streak * 0.2), 0.42 + streak * 0.12, 0.55);
		const pitch: number = 0.11;
		const k: number = ((y / pitch) % 1 + 1) % 1;
		const slot: number = coverage(Math.abs(k - 0.5) * pitch - 0.012, c.pixel);
		layer(t, slot, [34, 36, 40], 0.7, 0.2, -0.03);
		occlude(t, slot * 0.5);
		t.height += 0.012 * (1 - k);
		layer(t, 1 - coverage(Math.min(x, c.mw - x) - 0.012, c.pixel), mul(c.p.trim, 0.6), 0.5, 0.7, 0.01);
	},
	helipad(c, t, x, y): void {
		const u = x / c.mw, v = y / c.mh;
		resetTexel(t, [45, 106, 110], .84, 0);
		const radius = Math.hypot(u-.5,v-.5);
		const ring = coverage((Math.abs(radius-.4)-.012)*Math.min(c.mw,c.mh),c.pixel);
		const h = Math.max(rect(c,x,y,.35*c.mw,.3*c.mh,.39*c.mw,.7*c.mh),rect(c,x,y,.61*c.mw,.3*c.mh,.65*c.mw,.7*c.mh),rect(c,x,y,.39*c.mw,.48*c.mh,.61*c.mw,.52*c.mh));
		layer(t,Math.max(ring,h),[234,232,207],.9,0,.001);
	},
	roof_flat(c, t, x, y): void {
		const gravel: number = hash2(Math.floor(x / (c.pixel * 1.5)), Math.floor(y / (c.pixel * 1.5)), c.seed + 11);
		const patch: number = fbm(x * 0.9, y * 0.9, c.seed + 12, 3);
		resetTexel(t, mul(c.p.roof, 0.78 + patch * 0.3 + (gravel - 0.5) * 0.14), 0.88, 0);
		t.height = (gravel - 0.5) * 0.004;
		layer(t, 1 - coverage(Math.min(x, y, c.mw - x, c.mh - y) - 0.05, c.pixel), mul(c.p.roof, 0.6), 0.9, 0, 0.03);
	},
	roof_tile(c, t, x, y): void {
		const rowH: number = 0.32;
		const row: number = Math.floor(y / rowH);
		const tileW: number = 0.26;
		const shift: number = row % 2 === 0 ? 0 : tileW / 2;
		const col: number = Math.floor((x + shift) / tileW);
		const lx: number = (x + shift) - col * tileW;
		const ly: number = y - row * rowH;
		const tone: number = 0.82 + hash2(col, row, c.seed + 13) * 0.3;
		resetTexel(t, mul(c.p.roof, tone), 0.7, 0);
		const lift: number = ly / rowH;
		t.height = 0.03 * lift;
		occlude(t, (1 - lift) * 0.5 * Math.max(0, 1 - ly / 0.05));
		const edge: number = coverage(Math.min(lx, tileW - lx) - 0.008, c.pixel);
		occlude(t, (1 - edge) * 0.3);
		layer(t, 1 - coverage(rowH - ly - 0.012, c.pixel), mul(c.p.roof, 0.55), 0.8, 0, 0.03);
	},
	roof_metal(c, t, x, y): void {
		standingSeam(c, t, x, y, c.p.roof, 0.6);
	},
	trim(c, t, x, y): void {
		const v: number = y / c.mh;
		const grain: number = hash2(Math.floor(x / c.pixel), Math.floor(y / c.pixel), c.seed + 14);
		const stone: number = fbm(x * 4, y * 4, c.seed + 15, 3);
		resetTexel(t, mul(c.p.trim, 0.9 + stone * 0.18 + (grain - 0.5) * 0.04), 0.62, 0);
		t.height = 0.16 * Math.sin(Math.PI * Math.min(1, v * 1.2)) * 0.5 + (stone - 0.5) * 0.004;
		occlude(t, 0.35 * Math.max(0, (v - 0.8) / 0.2));
	},
	plinth(c, t, x, y): void {
		const bh: number = 0.34;
		const bw: number = 0.7;
		const row: number = Math.floor(y / bh);
		const col: number = Math.floor((x + (row % 2 === 0 ? 0 : bw / 2)) / bw);
		const lx: number = x + (row % 2 === 0 ? 0 : bw / 2) - col * bw;
		const ly: number = y - row * bh;
		const edge: number = Math.min(lx, bw - lx, ly, bh - ly);
		const body: number = coverage(0.008 - edge, c.pixel);
		const stone: number = fbm(x * 6, y * 6, c.seed + 16, 3);
		resetTexel(t, mul(c.p.trim, 0.42 + hash2(col, row, c.seed + 17) * 0.14 + stone * 0.14), 0.8, 0);
		layer(t, 1 - body, mul(c.p.trim, 0.3), 0.95, 0, -0.012);
		t.height += (stone - 0.5) * 0.01;
	},
	metal(c, t, x, y): void {
		const streak: number = fbm(x * 2, y * 60, c.seed + 18, 2);
		resetTexel(t, mul(mix(c.p.frame, ALUMINIUM, 0.55), 0.86 + streak * 0.24), 0.32 + streak * 0.18, 0.92);
		const rib: number = Math.abs(((y / 0.2) % 1 + 1) % 1 - 0.5) * 0.2;
		layer(t, coverage(rib - 0.085, c.pixel), mul(c.p.frame, 0.9), 0.45, 0.85, 0.01);
	},
	awning(c, t, x, y): void {
		const stripe: number = Math.floor(x / 0.14) % 2 === 0 ? 0 : 1;
		const weave: number = 0.5 + 0.5 * Math.cos((x * Math.PI * 2) / 0.012) * Math.cos((y * Math.PI * 2) / 0.012);
		const base: Rgb = stripe === 0 ? c.p.accent : mix(c.p.accent, [240, 240, 232], 0.82);
		resetTexel(t, mul(base, 0.94 + weave * 0.08), 0.95, 0);
		t.height = weave * 0.0015;
		const valance: number = coverage(y - (c.mh - 0.16), c.pixel);
		layer(t, valance, mul(base, 0.75), 0.95, 0, 0.012);
		occlude(t, Math.max(0, y / c.mh - 0.65) * 0.25);
	},
	sign(c, t, x, y): void {
		resetTexel(t, c.p.frame, 0.4, 0.5);
		layer(t, rect(c, x, y, 0.06 * c.mw, 0.22 * c.mh, 0.94 * c.mw, 0.78 * c.mh), c.p.accent, 0.35, 0.15, 0.02);
		layer(t, rect(c, x, y, 0.12 * c.mw, 0.34 * c.mh, 0.88 * c.mw, 0.46 * c.mh), c.p.trim, 0.4, 0.1, 0.035);
		layer(t, rect(c, x, y, 0.12 * c.mw, 0.54 * c.mh, 0.62 * c.mw, 0.62 * c.mh), c.p.trim, 0.4, 0.1, 0.035);
	},
};

export function paintPoint(kind: TileKind, c: TileCtx, t: Texel, x: number, y: number): void {
	painters[kind](c, t, x, y);
}
