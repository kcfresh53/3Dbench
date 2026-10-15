// Extracts a small fixture from Universal Animation Library (Quaternius, CC0) for the IK rig tests.
// Usage: node tests/tools/extract_ual_fixture.mjs <UAL1_RM.glb> <out.json> [clip names...]
import { readFileSync, writeFileSync } from 'node:fs';
import { loadModule } from '../ik_rig_support.mjs';

const [glb_path, out_path, ...requested] = process.argv.slice(2);
const clip_names = requested.length ? requested : ['Walk_Loop', 'Idle_Loop'];
const ik = await loadModule('js/animations/ik_rig/index.ts', 'ik');
const asset = ik.readGlb(new Uint8Array(readFileSync(glb_path)));
const round = (n) => Math.round(n * 1e5) / 1e5;
const tracks = (map) => Object.fromEntries([...map].map(([joint, t]) => [joint, { times: t.times.map(round), values: t.values.map(round) }]));
const fixture = {
	source: 'Universal Animation Library by Quaternius (CC0 1.0), root motion variant',
	names: asset.skeleton.names,
	parents: asset.skeleton.parents,
	bind: asset.skeleton.bind_local.map((t) => [...t.position, ...t.rotation].map(round)),
	clips: asset.clips.filter((c) => clip_names.includes(c.name)).map((c) => ({
		name: c.name, duration: round(c.duration), translation: tracks(c.translation), rotation: tracks(c.rotation),
	})),
};
writeFileSync(out_path, JSON.stringify(fixture));
console.log(`wrote ${out_path}: ${fixture.clips.length} clips, ${asset.skeleton.count} joints`);
