import type { RoadNetwork, RoadSegment } from '../../../../roadscape/src/core/model';
import { buildIndex, freezeHandles, segmentCurve } from '../../../../roadscape/src/core/network';
import type { Vec3 } from '../types';

export interface ElevationOptions {
    start: number;
    end: number;
    easing: 'linear' | 'smooth';
    structure: 'bridge' | 'air' | 'ground';
}

/** Orders a single open chain. Reject ambiguous selections before modifying anything. */
export function elevationChain(network: RoadNetwork, keys: string[]): string[] {
    const edges = [...new Set(keys)].map(key => network.segments.get(key));
    if (!edges.length || edges.some(s => !s)) throw new Error('Select road edges or points along one connected road first.');
    const links = new Map<string, string[]>();
    for (const s of edges as RoadSegment[]) {
        links.set(s.a, [...(links.get(s.a) ?? []), s.b]);
        links.set(s.b, [...(links.get(s.b) ?? []), s.a]);
    }
    const ends = [...links].filter(([, v]) => v.length === 1).map(([id]) => id).sort();
    if (ends.length !== 2 || [...links.values()].some(v => v.length > 2)) throw new Error('Select an open road chain without branches or loops.');
    const path = [ends[0]];
    while (path.length <= edges.length) {
        const next = links.get(path[path.length - 1])!.find(id => id !== path[path.length - 2]);
        if (!next) break;
        path.push(next);
    }
    if (path.length !== edges.length + 1) throw new Error('Selected roads must form one connected chain.');
    return path;
}

/** Authors a vertical cubic across a chain while retaining its exact horizontal curves. Heights use network units. */
export function setRoadElevation(network: RoadNetwork, keys: string[], options: ElevationOptions): string[] {
    if (!Number.isFinite(options.start) || !Number.isFinite(options.end)) throw new Error('Road heights must be finite.');
    const path = elevationChain(network, keys);
    const index = buildIndex(network);
    // Freeze all affected tangents before moving any shared control points.
    const touched = new Set(path);
    for (const s of network.segments.values()) if (touched.has(s.a) || touched.has(s.b)) freezeHandles(network, index, s);
    const spans = path.slice(1).map((id, i) => {
        const s = network.segments.get([path[i], id].sort().join('|'))!;
        const curve = segmentCurve(network, index, s);
        const points = curve.polyline(Math.max(curve.length / 32, 0.01));
        let length = 0;
        for (let j = 1; j < points.length; j++) length += Math.hypot(points[j][0] - points[j-1][0], points[j][2] - points[j-1][2]);
        return { s, length, forward: s.a === path[i] };
    });
    const total = spans.reduce((sum, span) => sum + span.length, 0);
    if (total < 1e-6) throw new Error('A ramp needs horizontal length.');
    const delta = options.end - options.start;
    const height = (t: number) => options.start + delta * (options.easing === 'smooth' ? t*t*(3-2*t) : t);
    const slope = (t: number) => delta * (options.easing === 'smooth' ? 6*t*(1-t) : 1);
    let distance = 0;
    network.nodes.get(path[0])!.position[1] = options.start;
    spans.forEach(({s, length, forward}, i) => {
        const a = distance / total, b = (distance + length) / total;
        const y0 = height(a), y1 = height(b);
        const c0 = y0 + slope(a)*(b-a)/3, c1 = y1 - slope(b)*(b-a)/3;
        network.nodes.get(path[i+1])!.position[1] = y1;
        (s.handleA as Vec3)[1] = forward ? c0-y0 : c1-y1;
        (s.handleB as Vec3)[1] = forward ? c1-y1 : c0-y0;
        s.structure = options.structure;
        distance += length;
    });
    return path;
}
