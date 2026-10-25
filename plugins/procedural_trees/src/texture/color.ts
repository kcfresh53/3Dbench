export type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb {
	const clean: string = hex.replace('#', '');
	const full: string = clean.length === 3 ? clean.split('').map((c: string): string => c + c).join('') : clean;
	const value: number = parseInt(full, 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function toCss(rgb: Rgb, alpha: number = 1): string {
	return `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${alpha})`;
}

/** factor < 1 darkens, factor > 1 lightens. */
export function shade(hex: string, factor: number): string {
	const rgb: Rgb = parseHex(hex);
	const out: Rgb = [
		Math.min(255, rgb[0] * factor),
		Math.min(255, rgb[1] * factor),
		Math.min(255, rgb[2] * factor),
	];
	return toCss(out);
}
