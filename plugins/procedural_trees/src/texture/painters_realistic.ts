import { Rng } from '../core/rng';
import { shade } from './color';
import type { Ctx2D, PixelRect } from './canvas_types';

/** Furrowed bark: dark wandering fissures, lighter ridges either side, speckle and short cracks. */
export function paintBarkRealistic(ctx: Ctx2D, r: PixelRect, base: string, rng: Rng): void {
	const unit: number = r.w / 128;
	ctx.fillStyle = base;
	ctx.fillRect(r.x, r.y, r.w, r.h);
	ctx.save();
	ctx.beginPath();
	ctx.rect(r.x, r.y, r.w, r.h);
	ctx.clip();

	// Broad tonal bands so the trunk is not one flat colour.
	for (let i = 0; i < 18; i++) {
		ctx.fillStyle = shade(base, rng.range(0.82, 1.15));
		ctx.globalAlpha = 0.45;
		ctx.fillRect(r.x + rng.next() * r.w, r.y, r.w * rng.range(0.04, 0.12), r.h);
	}
	ctx.globalAlpha = 1;

	const fissures: number = Math.round(r.w / (5 * unit));
	for (let i = 0; i < fissures; i++) {
		let x: number = r.x + rng.next() * r.w;
		const width: number = unit * rng.range(1.2, 3.2);
		const path: Array<[number, number]> = [];
		for (let y = r.y - 4; y <= r.y + r.h + 4; y += r.h / 24) {
			x += rng.range(-1.6, 1.6) * unit;
			path.push([x, y]);
		}
		const stroke = (offset: number, color: string, w: number, alpha: number): void => {
			ctx.strokeStyle = color;
			ctx.globalAlpha = alpha;
			ctx.lineWidth = w;
			ctx.lineJoin = 'round';
			ctx.beginPath();
			path.forEach((p: [number, number], k: number): void => {
				if (k === 0) ctx.moveTo(p[0] + offset, p[1]);
				else ctx.lineTo(p[0] + offset, p[1]);
			});
			ctx.stroke();
		};
		stroke(-width * 1.3, shade(base, 1.28), width * 1.1, 0.5);
		stroke(width * 1.4, shade(base, 1.18), width, 0.35);
		stroke(0, shade(base, 0.34), width, 0.9);
	}
	ctx.globalAlpha = 1;

	const cracks: number = Math.round(r.w * 0.7);
	for (let i = 0; i < cracks; i++) {
		ctx.fillStyle = shade(base, rng.range(0.4, 0.7));
		ctx.fillRect(r.x + rng.next() * r.w, r.y + rng.next() * r.h, unit * rng.range(2, 6), Math.max(1, unit * 0.9));
	}
	const specks: number = Math.round(r.w * r.h * 0.01);
	for (let i = 0; i < specks; i++) {
		ctx.fillStyle = shade(base, rng.range(0.6, 1.35));
		ctx.fillRect(r.x + rng.next() * r.w, r.y + rng.next() * r.h, Math.max(1, unit), Math.max(1, unit));
	}
	ctx.restore();
}

/** One pointed leaf with a midrib, drawn at the origin pointing along +x. */
function drawLeaf(
	ctx: Ctx2D,
	x: number,
	y: number,
	angle: number,
	length: number,
	width: number,
	color: string,
): void {
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(angle);
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.moveTo(0, 0);
	ctx.bezierCurveTo(length * 0.25, -width, length * 0.7, -width * 0.8, length, 0);
	ctx.bezierCurveTo(length * 0.7, width * 0.8, length * 0.25, width, 0, 0);
	ctx.fill();
	ctx.strokeStyle = shade(color, 0.6);
	ctx.lineWidth = Math.max(1, width * 0.12);
	ctx.beginPath();
	ctx.moveTo(0, 0);
	ctx.lineTo(length * 0.95, 0);
	ctx.stroke();
	ctx.restore();
}

/** Dense broadleaf cluster on short stems, alpha-cut at the silhouette. */
export function paintLeafCardBroadleaf(
	ctx: Ctx2D,
	r: PixelRect,
	colorA: string,
	colorB: string,
	rng: Rng,
): void {
	const size: number = r.w;
	const cx: number = r.x + size / 2;
	const cy: number = r.y + size / 2;
	const leafLength: number = size / 6.2;
	const stems: number = 7;
	ctx.save();
	ctx.beginPath();
	ctx.rect(r.x, r.y, r.w, r.h);
	ctx.clip();
	for (let s = 0; s < stems; s++) {
		const baseAngle: number = -Math.PI / 2 + (s - (stems - 1) / 2) * 0.26 + rng.range(-0.05, 0.05);
		const stemLength: number = size * rng.range(0.27, 0.38);
		const sx: number = cx + rng.range(-1, 1) * size * 0.05;
		const sy: number = r.y + size * 0.92;
		const ex: number = sx + Math.cos(baseAngle) * stemLength * 1.6;
		const ey: number = sy + Math.sin(baseAngle) * stemLength * 1.6;
		ctx.strokeStyle = shade(colorA, 0.45);
		ctx.lineWidth = Math.max(1, size / 90);
		ctx.beginPath();
		ctx.moveTo(sx, sy);
		ctx.lineTo(ex, ey);
		ctx.stroke();
		const leaves: number = 6;
		for (let l = 0; l < leaves; l++) {
			const t: number = (l + 1) / leaves;
			const px: number = sx + (ex - sx) * t;
			const py: number = sy + (ey - sy) * t;
			for (const side of [-1, 1]) {
				const color: string = shade(rng.next() > 0.5 ? colorA : colorB, rng.range(0.78, 1.2));
				drawLeaf(ctx, px, py, baseAngle + side * rng.range(0.55, 1.05), leafLength * rng.range(0.7, 1.1) * (1.1 - t * 0.35), leafLength * 0.3, color);
			}
		}
		drawLeaf(ctx, ex, ey, baseAngle, leafLength * 0.9, leafLength * 0.28, shade(colorB, rng.range(0.9, 1.15)));
	}
	// Soft cut so a few stray leaves fill the centre gap.
	for (let i = 0; i < 10; i++) {
		const a: number = rng.range(0, Math.PI * 2);
		const d: number = size * rng.range(0, 0.25);
		drawLeaf(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, rng.range(0, Math.PI * 2), leafLength * 0.8, leafLength * 0.26, shade(colorA, rng.range(0.7, 1)));
	}
	ctx.restore();
}

/** Conifer twig fan: central twigs covered in short needles. */
export function paintLeafCardNeedle(
	ctx: Ctx2D,
	r: PixelRect,
	colorA: string,
	colorB: string,
	rng: Rng,
): void {
	const size: number = r.w;
	ctx.save();
	ctx.beginPath();
	ctx.rect(r.x, r.y, r.w, r.h);
	ctx.clip();
	const twigs = 7;
	const needleLength: number = size / 11;
	for (let t = 0; t < twigs; t++) {
		const angle: number = -Math.PI / 2 + (t - (twigs - 1) / 2) * 0.3 + rng.range(-0.06, 0.06);
		const length: number = size * rng.range(0.55, 0.85);
		const sx: number = r.x + size * 0.5;
		const sy: number = r.y + size * 0.96;
		ctx.strokeStyle = shade(colorA, 0.4);
		ctx.lineWidth = Math.max(1, size / 80);
		ctx.beginPath();
		ctx.moveTo(sx, sy);
		ctx.lineTo(sx + Math.cos(angle) * length, sy + Math.sin(angle) * length);
		ctx.stroke();
		const needles: number = 26;
		for (let n = 0; n < needles; n++) {
			const f: number = (n + 1) / needles;
			const px: number = sx + Math.cos(angle) * length * f;
			const py: number = sy + Math.sin(angle) * length * f;
			for (const side of [-1, 1]) {
				const a: number = angle + side * rng.range(0.7, 1.15);
				const len: number = needleLength * (1.15 - f * 0.45) * rng.range(0.8, 1.15);
				ctx.strokeStyle = shade(rng.next() > 0.5 ? colorA : colorB, rng.range(0.75, 1.25));
				ctx.lineWidth = Math.max(1, size / 120);
				ctx.beginPath();
				ctx.moveTo(px, py);
				ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
				ctx.stroke();
			}
		}
	}
	ctx.restore();
}

/** Mottled opaque leaf field (used if a realistic preset is switched to blobs/tiers). */
export function paintSolidRealistic(
	ctx: Ctx2D,
	r: PixelRect,
	colorA: string,
	colorB: string,
	rng: Rng,
): void {
	ctx.fillStyle = shade(colorA, 0.55);
	ctx.fillRect(r.x, r.y, r.w, r.h);
	ctx.save();
	ctx.beginPath();
	ctx.rect(r.x, r.y, r.w, r.h);
	ctx.clip();
	const leaves: number = Math.round(r.w * 1.6);
	for (let i = 0; i < leaves; i++) {
		const color: string = shade(rng.next() > 0.5 ? colorA : colorB, rng.range(0.6, 1.25));
		drawLeaf(ctx, r.x + rng.next() * r.w, r.y + rng.next() * r.h, rng.range(0, Math.PI * 2), r.w / 9, r.w / 30, color);
	}
	ctx.restore();
}

/** Pale, papery bark with transverse lenticels instead of vertical furrows. */
export function paintBirchBark(ctx: Ctx2D, r: PixelRect, base: string, rng: Rng): void {
	ctx.fillStyle = base;
	ctx.fillRect(r.x,r.y,r.w,r.h);
	for(let i=0;i<110;i++) {
		const x=r.x+rng.next()*r.w, y=r.y+rng.next()*r.h;
		ctx.fillStyle=shade(base,rng.range(0.35,0.7));
		ctx.fillRect(x,y,r.w*rng.range(0.012,0.12),Math.max(1,r.h*rng.range(0.001,0.004)));
	}
}
