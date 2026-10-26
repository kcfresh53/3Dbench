export type Rgb = [number, number, number];
export declare function parseHex(hex: string): Rgb;
export declare function toCss(rgb: Rgb, alpha?: number): string;
/** factor < 1 darkens, factor > 1 lightens. */
export declare function shade(hex: string, factor: number): string;
