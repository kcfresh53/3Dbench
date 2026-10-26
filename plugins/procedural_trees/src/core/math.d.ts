import type { Vec3 } from './types';
export interface Frame {
    /** First radial axis. */
    u: Vec3;
    /** Second radial axis, always cross(direction, u). */
    v: Vec3;
    direction: Vec3;
}
export declare const add: (a: Vec3, b: Vec3) => Vec3;
export declare const sub: (a: Vec3, b: Vec3) => Vec3;
export declare const scale: (a: Vec3, s: number) => Vec3;
export declare const dot: (a: Vec3, b: Vec3) => number;
export declare const cross: (a: Vec3, b: Vec3) => Vec3;
export declare const length: (a: Vec3) => number;
export declare const lerp: (a: number, b: number, t: number) => number;
export declare const lerp3: (a: Vec3, b: Vec3, t: number) => Vec3;
export declare const clamp: (v: number, min: number, max: number) => number;
export declare const degToRad: (deg: number) => number;
export declare function normalize(a: Vec3): Vec3;
/** Any unit vector perpendicular to `direction`. */
export declare function perpendicular(direction: Vec3): Vec3;
/** Rodrigues rotation of `v` around `axis` by `angle` radians. */
export declare function rotateAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3;
/** Parallel-transport frames along a polyline, so rings never twist. */
export declare function transportFrames(points: Vec3[]): Frame[];
