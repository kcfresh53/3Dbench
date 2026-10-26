import type { Vec3 } from './types';
/** Small seeded PRNG (mulberry32) so a seed always yields the same tree. */
export declare class Rng {
    private state;
    constructor(seed: number);
    next(): number;
    range(min: number, max: number): number;
    unitVector(): Vec3;
}
