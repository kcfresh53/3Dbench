import type { PlacedBuilding } from '../city/compose';
import type { Heightfield } from '../terrain/heightfield';
import type { MeshPart, Vec3 } from '../types';

/** Solid skirts close remaining gaps between level buildings and the triangulated terrain.
 * Bottom edges use one conservative height for the complete footprint, so no terrain triangle
 * can open a gap between perimeter samples. The geometry is identical in preview, bake and export.
 */
export function foundationMesh(buildings: PlacedBuilding[], hf: Heightfield): MeshPart {
	const part: MeshPart = { name: 'foundations', atlas: 'foundation', positions: [], faces: [] };
	for (const b of buildings) {
		if (b.spec.archetype === 'wind_turbine') continue;
		const hw = b.width / 2 + 0.06, hd = b.depth / 2 + 0.06;
		const cos = Math.cos(b.yaw), sin = Math.sin(b.yaw);
		const world = (x: number, z: number): Vec3 => [b.x + x * cos + z * sin, b.y - 0.01, b.z - x * sin + z * cos];
		const corners = [world(-hw, -hd), world(-hw, hd), world(hw, hd), world(hw, -hd)];
		const xs = corners.map(p => p[0]), zs = corners.map(p => p[2]);
		const bottom = Math.min(b.y - 0.25, hf.range(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)).min - 0.2);
		const base = part.positions.length;
		part.positions.push(...corners, ...corners.map((p): Vec3 => [p[0], bottom, p[2]]));
		part.faces.push({ indices: [base, base + 1, base + 2, base + 3], uvs: [[0, 0], [0, hd * 2 / 3], [hw * 2 / 3, hd * 2 / 3], [hw * 2 / 3, 0]] });
		for (let i = 0; i < 4; i++) {
			const j = (i + 1) % 4, length = Math.hypot(corners[i][0] - corners[j][0], corners[i][2] - corners[j][2]);
			part.faces.push({ indices: [base + i, base + i + 4, base + j + 4, base + j], uvs: [[0, 0], [0, (b.y - bottom) / 3], [length / 3, (b.y - bottom) / 3], [length / 3, 0]] });
		}
	}
	return part;
}
