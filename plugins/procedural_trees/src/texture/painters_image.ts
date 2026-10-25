import type { Ctx2D, PixelRect } from './canvas_types';

export function loadImage(source: string): Promise<HTMLImageElement> {
	return new Promise<HTMLImageElement>((resolve: (img: HTMLImageElement) => void, reject: (e: Error) => void): void => {
		const image: HTMLImageElement = new Image();
		image.onload = (): void => resolve(image);
		image.onerror = (): void => reject(new Error('Could not decode the supplied texture image.'));
		image.src = source;
	});
}

/**
 * Fills the bark region with the image, tiled along V with alternate tiles mirrored
 * so the join between repeats is hidden even when the photo is not seamless.
 */
export function drawBarkImage(ctx: Ctx2D, r: PixelRect, image: HTMLImageElement): void {
	const tileHeight: number = Math.max(1, Math.round((r.w * image.naturalHeight) / image.naturalWidth));
	ctx.save();
	ctx.beginPath();
	ctx.rect(r.x, r.y, r.w, r.h);
	ctx.clip();
	for (let y = 0, row = 0; y < r.h; y += tileHeight, row++) {
		if (row % 2 === 0) {
			ctx.drawImage(image, r.x, r.y + y, r.w, tileHeight);
		} else {
			ctx.save();
			ctx.translate(0, r.y + y + tileHeight);
			ctx.scale(1, -1);
			ctx.drawImage(image, r.x, 0, r.w, tileHeight);
			ctx.restore();
		}
	}
	ctx.restore();
}

/** Fits the whole image (alpha preserved) inside the square leaf region. */
export function drawLeafImage(ctx: Ctx2D, r: PixelRect, image: HTMLImageElement, tint?: string): void {
	let source: CanvasImageSource = image;
	if (tint) {
		const canvas = document.createElement('canvas');
		canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
		const color = canvas.getContext('2d')!;
		color.drawImage(image,0,0);
		color.globalCompositeOperation = 'source-atop';
		color.globalAlpha = 0.45;
		color.fillStyle = tint;
		color.fillRect(0,0,canvas.width,canvas.height);
		source = canvas;
	}
	const scale: number = Math.min(r.w / image.naturalWidth, r.h / image.naturalHeight);
	const w: number = image.naturalWidth * scale;
	const h: number = image.naturalHeight * scale;
	ctx.drawImage(source, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
}
