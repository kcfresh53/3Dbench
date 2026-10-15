// Optional integration check against the user's animation libraries; no assets are copied into the repo.
// Usage: node tests/tools/validate_ual_ik.mjs path/to/UAL1_RM.glb path/to/UAL2_Standard_RM.glb
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModule } from '../ik_rig_support.mjs';
const ik = await loadModule('js/animations/ik_rig/index.ts', 'ik');
assert(process.argv.length > 2, 'Supply one or more animation GLBs');
for (const file of process.argv.slice(2)) {
	const { skeleton, clips } = ik.readGlb(new Uint8Array(readFileSync(file)));
	const { joints } = ik.mapHumanoidJoints(skeleton.names, skeleton.parents);
	const config = ik.createHumanoidRigConfig(new Set(Object.keys(joints)));
	config.solvers.find(s => s.kind == 'body').crouch = 0.2;
	config.solvers.find(s => s.kind == 'spine').lean_forward_deg = 15;
	const rig = new ik.IKRig(new ik.RigBinding(skeleton, config, joints));
	let frames = 0;
	for (const clip of clips) {
		for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
			const time = clip.duration * fraction;
			const fk = ik.sampleClip(skeleton, clip, time);
			const { pose } = rig.evaluate(fk, { time });
			for (let j = 0; j < skeleton.count; j++) {
				assert([...pose.worldPosition(j), ...pose.worldRotation(j)].every(Number.isFinite), `${clip.name}: finite transforms`);
				const parent = skeleton.parents[j];
				if (parent < 0 || j == joints.pelvis) continue;
				assert(Math.abs(ik.distance(pose.worldPosition(j), pose.worldPosition(parent)) - ik.distance(fk.worldPosition(j), fk.worldPosition(parent))) < 1e-5, `${clip.name}: bone length`);
			}
			frames++;
		}
	}
	console.log(`${file}: ${clips.length} clips, ${frames} styled poses, finite transforms and preserved bone lengths`);
}
