import type { CrownShape } from './types';
import { clamp } from './math';

/** Branch-length multiplier along the trunk, t = 0 (base) .. 1 (top). */
export function crownFactor(shape: CrownShape, t: number): number {
	const x: number = clamp(t, 0, 1);
	switch (shape) {
		case 'conical':
			return 0.12 + 0.88 * Math.pow(1 - x, 0.9);
		case 'columnar':
			return 0.55 + 0.45 * Math.sin(Math.PI * (0.08 + 0.84 * x));
		case 'vase':
			return 0.3 + 0.7 * x;
		case 'round':
		default:
			return 0.25 + 0.75 * Math.sin(Math.PI * (0.08 + 0.84 * x));
	}
}
