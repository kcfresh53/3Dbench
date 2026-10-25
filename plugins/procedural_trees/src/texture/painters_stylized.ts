import { Rng } from '../core/rng';
import { shade } from './color';
import type { Ctx2D, PixelRect } from './canvas_types';

/** Vertical streaks with a few breaks. Stretching along a branch is invisible. */
export function paintBarkStylized(ctx: Ctx2D, r: PixelRect, base: string, rng: Rng): void {
	ctx.fillStyle = shade(base, 1);
	ctx.fillRect(r.x, r.y, r.w, r.h);
	let column = 0;
	while (column < r.w) {
		const width: number = Math.max(1, Math.round((r.w / 64) * (1 + Math.floor(rng.next() * 3))));
		ctx.fillStyle = shade(base, rng.range(0.72, 1.12));
		ctx.fillRect(r.x + column, r.y, width, r.h);
		column += width;
	}
	const unit: number = r.w / 64;
	const breaks: number = Math.round(r.w * 0.9);
	for (let i = 0; i < breaks; i++) {
		ctx.fillStyle = shade(base, rng.range(0.55, 1.2));
		ctx.fillRect(
			r.x + Math.floor(rng.next() * r.w),
			r.y + Math.floor(rng.next() * r.h),
			Math.max(1, unit * (1 + Math.floor(rng.next() * 2))),
			unit * (2 + Math.floor(rng.next() * 8)),
		);
	}
}

/** Chunky alpha-cut leaf cluster: the reference stylized look. */
export function paintLeafCardStylized(
	ctx: Ctx2D,
	r: PixelRect,
	colorA: string,
	colorB: string,
	rng: Rng,
): void {
	const size: number = r.w;
	const leafLength: number = size / 7;
	const count: number = Math.round((size * size) / (leafLength * leafLength * 0.4));
	const radius: number = size * 0.44;
	const palette: string[] = [colorA, colorB, shade(colorA, 1.15), shade(colorB, 0.85)];
	const dark: string = shade(colorA, 0.5);
	const cx: number = r.x + size / 2;
	const cy: number = r.y + size / 2;
	const drop: number = Math.max(1, size / 64);
	for (let i = 0; i < count; i++) {
		const angle: number = rng.range(0, Math.PI * 2);
		const dist: number = radius * Math.sqrt(rng.next());
		const px: number = cx + Math.cos(angle) * dist;
		const py: number = cy + Math.sin(angle) * dist;
		const rotation: number = rng.range(0, Math.PI);
		ctx.fillStyle = dark;
		ctx.beginPath();
		ctx.ellipse(px, py + drop, leafLength * 0.5, leafLength * 0.25, rotation, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = palette[Math.floor(rng.next() * palette.length)];
		ctx.beginPath();
		ctx.ellipse(px, py, leafLength * 0.5, leafLength * 0.25, rotation, 0, Math.PI * 2);
		ctx.fill();
	}
}

/**
 * Opaque foliage field for blobs and tiers. Large soft clumps with a lighter
 * top edge, so even a small projected face reads as leafy rather than as noise.
 */
export function paintSolidStylized(
	ctx: Ctx2D,
	r: PixelRect,
	colorA: string,
	colorB: string,
	rng: Rng,
): void {
	ctx.fillStyle = shade(colorA, 0.72);
	ctx.fillRect(r.x, r.y, r.w, r.h);
	ctx.save();
	ctx.beginPath();
	ctx.rect(r.x, r.y, r.w, r.h);
	ctx.clip();
	for (let i = 0; i < 46; i++) {
		const radius = r.w * rng.range(0.07, 0.16);
		const cx = r.x + rng.next() * r.w;
		const cy = r.y + rng.next() * r.h;
		const base = i % 3 === 0 ? colorB : colorA;
		ctx.fillStyle = shade(base, rng.range(0.78, 0.95));
		ctx.beginPath();
		ctx.arc(cx, cy + radius * 0.12, radius, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = shade(base, rng.range(1.05, 1.3));
		ctx.beginPath();
		ctx.arc(cx, cy - radius * 0.14, radius * 0.78, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.restore();
}
