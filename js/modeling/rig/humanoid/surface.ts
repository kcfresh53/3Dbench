import { MeshSpec } from './humanoid_types';
import { mergeMeshes } from './loft';
import { distance, Vec3 } from './vec';

/** A port is an ordered boundary loop. Bridges share its vertices (no overlapping caps). */
interface Part { mesh: MeshSpec; sides: number; start: number[]; end: number[] }

function part(mesh: MeshSpec, sides: number): Part {
	const end = mesh.vertices.length - 2 - sides;
	return { mesh, sides, start: Array.from({ length: sides }, (_, i) => i), end: Array.from({ length: sides }, (_, i) => end + i) };
}
function uncap(p: Part, end: boolean): number[] {
	const center = p.mesh.vertices.length - (end ? 1 : 2);
	p.mesh.faces = p.mesh.faces.filter(face => !face.includes(center));
	return end ? p.end : p.start;
}

/** Remove a connected patch and return its perimeter, excluding all internal edges. */
function port(mesh: MeshSpec, faces: number[][]): number[] {
	const edges = new Map<string, { a: number; b: number; count: number }>();
	for (const face of faces) for (let i = 0; i < face.length; i++) {
		const a = face[i], b = face[(i + 1) % face.length];
		const key = [a, b].sort((a, b) => a - b).join(':');
		const edge = edges.get(key);
		if (edge) edge.count++;
		else edges.set(key, { a, b, count: 1 });
	}
	const boundary = [...edges.values()].filter(e => e.count === 1);
	const loop: number[] = [boundary[0].a];
	while (loop.length < boundary.length) {
		const current = loop[loop.length - 1];
		const edge = boundary.find(e => (e.a === current && !loop.includes(e.b)) || (e.b === current && !loop.includes(e.a)));
		if (!edge) throw new Error('Humanoid surface port is not a simple loop');
		loop.push(edge.a === current ? edge.b : edge.a);
	}
	const removed = new Set(faces);
	mesh.faces = mesh.faces.filter(f => !removed.has(f));
	return loop;
}

/** Join loops with a minimum-distance correspondence; retain quads wherever counts agree. */
function bridge(mesh: MeshSpec, a: number[], input: number[]): void {
	let b = input;
	let best = Infinity;
	for (const direction of [input, input.slice().reverse()]) for (let shift = 0; shift < input.length; shift++) {
		const candidate = direction.map((_, i) => direction[(i + shift) % direction.length]);
		let score = 0;
		for (let i = 0; i < a.length; i++) score += distance(mesh.vertices[a[i]], mesh.vertices[candidate[Math.round(i * candidate.length / a.length) % candidate.length]]);
		if (score < best) { best = score; b = candidate; }
	}
	// Identical rings are welded instead of bridged by zero-area faces.
	if (a.length === b.length && a.every((v, i) => distance(mesh.vertices[v], mesh.vertices[b[i]]) < 1e-7)) {
		const replacements = new Map(b.map((v, i) => [v, a[i]]));
		mesh.faces = mesh.faces.map(face => face.map(v => replacements.get(v) ?? v));
		return;
	}
	let i = 0, j = 0;
	while (i < a.length || j < b.length) {
		const nextA = (i + 1) / a.length, nextB = (j + 1) / b.length;
		const av = a[i % a.length], bv = b[j % b.length];
		if (Math.abs(nextA - nextB) < 1e-8) {
			mesh.faces.push([av, a[(i + 1) % a.length], b[(j + 1) % b.length], bv]); i++; j++;
		} else if (nextA < nextB) {
			mesh.faces.push([av, a[(i + 1) % a.length], bv]); i++;
		} else {
			mesh.faces.push([av, b[(j + 1) % b.length], bv]); j++;
		}
	}
}

/** Remove unused cap centers, consistently orient faces, then point each shell outwards. */
export function finishSurface(mesh: MeshSpec): MeshSpec {
	const used = [...new Set(mesh.faces.flat())].sort((a, b) => a - b);
	const indices = new Map(used.map((v, i) => [v, i]));
	mesh.vertices = used.map(i => mesh.vertices[i]);
	mesh.vertex_weights = used.map(i => mesh.vertex_weights[i]);
	mesh.faces = mesh.faces.map(f => f.map(i => indices.get(i)!));
	const edges = new Map<string, { face: number; direction: number }[]>();
	mesh.faces.forEach((f, fi) => f.forEach((a, i) => {
		const b = f[(i + 1) % f.length], key = [a, b].sort((a, b) => a - b).join(':');
		if (!edges.has(key)) edges.set(key, []);
		edges.get(key)!.push({ face: fi, direction: a < b ? 1 : -1 });
	}));
	const neighbors: { face: number; same: boolean }[][] = mesh.faces.map(() => []);
	for (const entries of edges.values()) if (entries.length === 2) {
		const [a, b] = entries;
		neighbors[a.face].push({ face: b.face, same: a.direction === b.direction });
		neighbors[b.face].push({ face: a.face, same: a.direction === b.direction });
	}
	const flips = new Map<number, boolean>();
	for (let start = 0; start < mesh.faces.length; start++) {
		if (flips.has(start)) continue;
		const queue = [start]; flips.set(start, false);
		for (let i = 0; i < queue.length; i++) for (const next of neighbors[queue[i]]) {
			if (!flips.has(next.face)) {
				flips.set(next.face, flips.get(queue[i])! !== next.same);
				queue.push(next.face);
			}
		}
		let volume = 0;
		for (const fi of queue) {
			if (flips.get(fi)) mesh.faces[fi].reverse();
			const f = mesh.faces[fi], a = mesh.vertices[f[0]];
			for (let i = 1; i < f.length - 1; i++) {
				const b = mesh.vertices[f[i]], c = mesh.vertices[f[i + 1]];
				volume += a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
			}
		}
		if (volume < 0) for (const fi of queue) mesh.faces[fi].reverse();
	}
	return mesh;
}

/** Stitch the torso, neck, head and limbs into a continuous skinned body. */
export function assembleBody(meshes: MeshSpec[], sides: number): MeshSpec[] {
	const parts = new Map(meshes.map(m => [m.name, part(m, ['torso', 'neck', 'head'].includes(m.name) ? 12 : m.name.startsWith('ear.') ? 8 : m.name.startsWith('hand.') && meshes.some(m => m.name.startsWith('index.')) ? 10 : /^(index|middle|ring|pinky|thumb)\./.test(m.name) ? 6 : sides)]));
	const torso = parts.get('torso')!;
	const joins: [Part, number[], Part, number[]][] = [];
	const neck = parts.get('neck')!, head = parts.get('head')!;
	joins.push([torso, uncap(torso, true), neck, uncap(neck, false)]);
	joins.push([neck, uncap(neck, true), head, uncap(head, false)]);
	for (const side of ['L', 'R']) {
		const ear = parts.get('ear.' + side);
		if (!ear) continue;
		const xIndex = side === 'R' ? 0 : 6;
		const headMin = head.mesh.vertices[head.start[0]][1], headMax = head.mesh.vertices[head.end[0]][1];
		const patch = head.mesh.faces.filter(f => f.length === 4 && f.some(v => v % 12 === xIndex) && f.every(v => {
			const t = (head.mesh.vertices[v][1] - headMin) / (headMax - headMin);
			return t >= 0.32 - 1e-6 && t <= 0.46 + 1e-6;
		}));
		const perimeter = port(head.mesh, patch);
		const center = perimeter.reduce((c, i) => c.map((v, k) => v + head.mesh.vertices[i][k] / perimeter.length) as Vec3, [0, 0, 0] as Vec3);
		const inset = perimeter.map(i => {
			const v = head.mesh.vertices[i];
			const index = head.mesh.vertices.length;
			head.mesh.vertices.push([v[0], v[1], center[2] + (v[2] - center[2]) * 0.27]);
			head.mesh.vertex_weights.push({ head: 1 });
			return index;
		});
		bridge(head.mesh, perimeter, inset);
		joins.push([head, inset, ear, uncap(ear, false)]);
	}
	const pelvis = uncap(torso, false);
	for (const side of ['L', 'R']) {
		const arm = parts.get('arm.' + side)!, hand = parts.get('hand.' + side)!;
		const leg = parts.get('leg.' + side)!, foot = parts.get('foot.' + side)!;
		const sign = side === 'R' ? 1 : -1;
		// Two columns on the outer shoulder, from the armpit to the shoulder ridge.
		const rings = (torso.mesh.vertices.length - 2) / 12;
		const top = torso.mesh.vertices[(rings - 2) * 12][1];
		const bottom = torso.mesh.vertices[0][1];
		const low = bottom + (top - bottom) * 0.76;
		const patch = torso.mesh.faces.filter(f => f.length === 4 && f.every(v => torso.mesh.vertices[v][0] * sign > 0) && f.every(v => torso.mesh.vertices[v][1] >= low - 1e-6 && torso.mesh.vertices[v][1] <= top + 1e-6) && f.some(v => v % 12 === (sign > 0 ? 0 : 6)));
		joins.push([torso, port(torso.mesh, patch), arm, uncap(arm, false)]);
		joins.push([arm, uncap(arm, true), hand, uncap(hand, false)]);
		if (parts.has('index.' + side)) {
			for (const [i, name] of ['index', 'middle', 'ring', 'pinky'].entries()) {
				const finger = parts.get(name + '.' + side)!;
				const cap = hand.mesh.faces.find(f => f.length === 4 && f.includes(20 + i) && f.includes(21 + i) && f.includes(29 - i))!;
				joins.push([hand, port(hand.mesh, [cap]), finger, uncap(finger, false)]);
			}
		}
		const thumb = parts.get('thumb.' + side);
		if (thumb) {
			let sideFace: number[];
			if (hand.sides === 10) sideFace = hand.mesh.faces.find(f => f.length === 4 && f.includes(0) && f.includes(9))!;
			else {
				const target = thumb.mesh.vertices[thumb.mesh.vertices.length - 2];
				const candidates = hand.mesh.faces.filter(f => f.length === 4);
				const dist = (f: number[]) => distance(f.reduce((c, v) => c.map((n, i) => n + hand.mesh.vertices[v][i] / f.length) as Vec3, [0, 0, 0] as Vec3), target);
				candidates.sort((a, b) => dist(a) - dist(b));
				sideFace = candidates[0];
			}
			joins.push([hand, port(hand.mesh, [sideFace]), thumb, uncap(thumb, false)]);
		}
		// The front/back center vertices form one shared crotch edge.
		const half = sign > 0 ? [9, 10, 11, 0, 1, 2, 3] : [3, 4, 5, 6, 7, 8, 9];
		joins.push([torso, half.map(i => pelvis[i]), leg, uncap(leg, false)]);
		// Ankle socket on the upper foot, around the instep.
		const ankle = leg.mesh.vertices.slice(-2)[1];
		const candidates = foot.mesh.faces.filter(f => f.length === 4);
		const center = (f: number[]): Vec3 => f.reduce((c, v) => c.map((n, i) => n + foot.mesh.vertices[v][i] / f.length) as Vec3, [0, 0, 0] as Vec3);
		candidates.sort((a, b) => distance(center(a), ankle) - distance(center(b), ankle));
		joins.push([leg, uncap(leg, true), foot, port(foot.mesh, [candidates[0]])]);
	}
	const bodyParts = [...parts.values()];
	const offsets = new Map<Part, number>();
	let offset = 0;
	for (const p of bodyParts) { offsets.set(p, offset); offset += p.mesh.vertices.length; }
	const body = mergeMeshes('body', bodyParts.map(p => p.mesh));
	for (const [a, al, b, bl] of joins) bridge(body, al.map(i => i + offsets.get(a)!), bl.map(i => i + offsets.get(b)!));
	return [finishSurface(body), ...meshes.filter(m => !bodyParts.some(p => p.mesh === m))];
}
