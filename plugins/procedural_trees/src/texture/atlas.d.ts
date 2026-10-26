import type { TreeParams } from '../core/types';
/**
 * Paints the single bark + leaf atlas and returns it as a PNG data URL.
 * A user supplied image replaces the procedural paint for its slot; the
 * foliage field and any slot left empty fall back to the procedural painters.
 */
export declare function paintAtlas(p: TreeParams): Promise<string>;
