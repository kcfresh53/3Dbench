import type { TreeParams } from '../core/types';
import { Rng } from '../core/rng';
import { REGION_BARK, REGION_LEAF_CARD, REGION_SOLID } from '../core/uv_layout';
import type { Region } from '../core/uv_layout';
import type { Ctx2D, PixelRect } from './canvas_types';
import { paintBarkStylized, paintLeafCardStylized, paintSolidStylized } from './painters_stylized';
import {
	paintBarkRealistic,
	paintBirchBark,
	paintLeafCardBroadleaf,
	paintLeafCardNeedle,
	paintSolidRealistic,
} from './painters_realistic';
import { paintPalmBark, paintPalmLeaf } from './painters_palm';
import { BUNDLED_TEXTURES } from './bundled';
import { drawBarkImage, drawLeafImage, loadImage } from './painters_image';

function toPixels(region: Region, size: number): PixelRect {
	return {
		x: Math.round(region.x * size),
		y: Math.round(region.y * size),
		w: Math.round(region.w * size),
		h: Math.round(region.h * size),
	};
}

/**
 * Paints the single bark + leaf atlas and returns it as a PNG data URL.
 * A user supplied image replaces the procedural paint for its slot; the
 * foliage field and any slot left empty fall back to the procedural painters.
 */
export async function paintAtlas(p: TreeParams): Promise<string> {
	const size: number = p.textureSize;
	const canvas: HTMLCanvasElement = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx: Ctx2D | null = canvas.getContext('2d');
	if (!ctx) throw new Error('Could not create a 2D canvas for the tree atlas.');
	ctx.imageSmoothingEnabled = p.variant === 'realistic';
	ctx.imageSmoothingQuality = 'high';

	const rng: Rng = new Rng(p.seed * 31 + 17);
	const bark: PixelRect = toPixels(REGION_BARK, size);
	const leaf: PixelRect = toPixels(REGION_LEAF_CARD, size);
	const solid: PixelRect = toPixels(REGION_SOLID, size);
	const realistic: boolean = p.variant === 'realistic';

	const palm = p.leafKind === 'palm' || p.foliageStyle === 'fronds';
	const photographic = realistic && p.useBundledTextures && !palm;
	// Pale bark stays procedural for birch; supplied images always take priority.
	const paleBark = parseInt(p.barkColor.slice(1, 3), 16) > 180;
	const barkSource = (p.useCustomTextures && p.barkImage) || (photographic && !paleBark ? (p.leafKind === 'needle' ? BUNDLED_TEXTURES.pineBark : BUNDLED_TEXTURES.bark) : '');
	const leafSource = (p.useCustomTextures && p.leafImage) || (photographic ? (p.leafKind === 'needle' ? BUNDLED_TEXTURES.needle : BUNDLED_TEXTURES.leaf) : '');
	const [barkImage, leafImage] = await Promise.all([barkSource ? loadImage(barkSource) : null, leafSource ? loadImage(leafSource) : null]);

	if (barkImage) drawBarkImage(ctx, bark, barkImage);
	else if (palm) paintPalmBark(ctx, bark, p.barkColor, rng);
	else if (realistic && paleBark) paintBirchBark(ctx, bark, p.barkColor, rng);
	else if (realistic) paintBarkRealistic(ctx, bark, p.barkColor, rng);
	else paintBarkStylized(ctx, bark, p.barkColor, rng);

	if (leafImage) drawLeafImage(ctx, leaf, leafImage, photographic && !(p.useCustomTextures && p.leafImage) && p.leafKind === 'needle' ? p.leafColor2 : undefined);
	else if (palm) paintPalmLeaf(ctx, leaf, p.leafColor, p.leafColor2);
	else if (!realistic) paintLeafCardStylized(ctx, leaf, p.leafColor, p.leafColor2, rng);
	else if (p.leafKind === 'needle') paintLeafCardNeedle(ctx, leaf, p.leafColor, p.leafColor2, rng);
	else paintLeafCardBroadleaf(ctx, leaf, p.leafColor, p.leafColor2, rng);

	// Realistic cards never sample the old opaque foliage field. Leave that
	// quarter transparent unless blobs/tiers actually need it.
	if (palm) { ctx.fillStyle = p.leafColor; ctx.fillRect(solid.x, solid.y, solid.w, solid.h); }
	else if (!realistic) paintSolidStylized(ctx, solid, p.leafColor, p.leafColor2, rng);
	else if (p.foliageStyle === 'blobs' || p.foliageStyle === 'tiers') {
		paintSolidRealistic(ctx, solid, p.leafColor, p.leafColor2, rng);
	}

	return canvas.toDataURL('image/png');
}
