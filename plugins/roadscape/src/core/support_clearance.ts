import type { RoadNetwork } from './model';
import { buildIndex, resolveProfileData, segmentCurve } from './network';
import { resolveProfile } from './profile_resolve';
import type { Vec3 } from './types';

interface Obstacle { key: string; a: Vec3; b: Vec3; radius: number }
/** Spatially indexed road envelopes, built once per generation rather than scanning roads per pier. */
export class SupportClearance {
    readonly revision: string;
    private cells = new Map<string, Obstacle[]>();
    private cell: number;
    static key(network: RoadNetwork): string {
        const data = JSON.stringify([[...network.nodes.values()].map(n => [n.id, n.position]), [...network.segments.values()], [...network.profiles], network.settings.weather, network.settings.unitsPerMeter]);
        let a = 2166136261, b = 5381;
        for (let i = 0; i < data.length; i++) { a = Math.imul(a ^ data.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ data.charCodeAt(i); }
        return (a >>> 0).toString(36) + ':' + (b >>> 0).toString(36);
    }
    constructor(network: RoadNetwork, revision: string = SupportClearance.key(network)) {
        const unit = network.settings.unitsPerMeter;
        this.cell = 24 * unit;
        this.revision = revision;
        const index = buildIndex(network);
        for (const s of network.segments.values()) {
            const p = resolveProfile(resolveProfileData(network, s.profile), unit, network.settings.weather);
            const radius = Math.max(p.extent.left, p.extent.right) + 1.5 * unit;
            const points = segmentCurve(network, index, s).polyline(4 * unit);
            for (let i = 1; i < points.length; i++) {
                const a = points[i-1], b = points[i];
                const obstacle = { key: s.key, a, b, radius };
                for (let x = Math.floor((Math.min(a[0],b[0])-radius)/this.cell); x <= Math.floor((Math.max(a[0],b[0])+radius)/this.cell); x++) {
                    for (let z = Math.floor((Math.min(a[2],b[2])-radius)/this.cell); z <= Math.floor((Math.max(a[2],b[2])+radius)/this.cell); z++) {
                        const key = x + ':' + z;
                        const bucket = this.cells.get(key);
                        if (bucket) bucket.push(obstacle); else this.cells.set(key, [obstacle]);
                    }
                }
            }
        }
    }
    allows(owner: string, centre: Vec3, bottom: number, top: number, clearance: number): boolean {
        const bucket = this.cells.get(Math.floor(centre[0]/this.cell) + ':' + Math.floor(centre[2]/this.cell)) ?? [];
        for (const o of bucket) {
            if (o.key === owner) continue;
            const dx = o.b[0]-o.a[0], dz = o.b[2]-o.a[2];
            const t = Math.max(0, Math.min(1, ((centre[0]-o.a[0])*dx+(centre[2]-o.a[2])*dz)/(dx*dx+dz*dz || 1)));
            const y = o.a[1]+t*(o.b[1]-o.a[1]);
            if (y < bottom-clearance || y > top+clearance) continue;
            if (Math.hypot(centre[0]-o.a[0]-t*dx,centre[2]-o.a[2]-t*dz) <= o.radius) return false;
        }
        return true;
    }
}
