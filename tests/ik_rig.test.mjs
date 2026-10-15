import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { loadModule } from './ik_rig_support.mjs';

const ik = await loadModule('js/animations/ik_rig/index.ts', 'ik_rig');
const names = await loadModule('js/modeling/rig/humanoid/bone_names.ts', 'bone_names');

// --- fixtures -------------------------------------------------------------------------------------
function loadUal() {
	const data = JSON.parse(readFileSync(new URL('./fixtures/ual1_rm_subset.json', import.meta.url)));
	const skeleton = new ik.Skeleton(data.names, data.parents, data.bind.map((b) => ({ position: b.slice(0, 3), rotation: b.slice(3, 7) })));
	const toMap = (object, stride) => new Map(Object.entries(object).map(([joint, t]) => [Number(joint), { times: t.times, values: t.values, stride, step: false }]));
	const clips = data.clips.map((c) => ({ name: c.name, duration: c.duration, translation: toMap(c.translation, 3), rotation: toMap(c.rotation, 4) }));
	return { skeleton, clips };
}
const ual = loadUal();
const mapping = ik.mapHumanoidJoints(ual.skeleton.names, ual.skeleton.parents);

function makeRig(skeleton, joints = mapping.joints, edit) {
	const config = ik.createHumanoidRigConfig(new Set(Object.keys(joints)));
	if (edit) edit(config);
	return new ik.IKRig(new ik.RigBinding(skeleton, config, joints));
}
function clipSource(rig, clip) {
	return { binding: rig.binding, sample: (t) => ik.sampleClip(ual.skeleton, clip, t), duration: clip.duration };
}
function proportionedSkeleton(factors) {
	const bind = ual.skeleton.bind_local.map((t) => ({ position: [...t.position], rotation: [...t.rotation] }));
	for (const [key, factor] of Object.entries(factors)) {
		const joint = mapping.joints[key];
		bind[joint].position = bind[joint].position.map((x) => x * factor);
	}
	return new ik.Skeleton(ual.skeleton.names, ual.skeleton.parents, bind);
}
const clip = (name) => ual.clips.find((c) => c.name == name);

// --- math -----------------------------------------------------------------------------------------
test('quaternion helpers rotate vectors consistently', () => {
	const q = ik.quatFromAxisAngle([0, 1, 0], Math.PI / 2);
	const v = ik.quatRotate(q, [1, 0, 0]);
	assert(ik.distance(v, [0, 0, -1]) < 1e-9);
	const from_to = ik.quatFromTo([1, 0, 0], [0, 0, 1]);
	assert(ik.distance(ik.quatRotate(from_to, [1, 0, 0]), [0, 0, 1]) < 1e-9);
	const opposite = ik.quatFromTo([0, 1, 0], [0, -1, 0]);
	assert(ik.distance(ik.quatRotate(opposite, [0, 1, 0]), [0, -1, 0]) < 1e-9);
	const { swing, twist } = ik.quatSwingTwist(ik.quatMul(ik.quatFromAxisAngle([1, 0, 0], 0.4), ik.quatFromAxisAngle([0, 1, 0], 0.7)), [0, 1, 0]);
	assert(Math.abs(ik.quatAngle(twist) - 0.7) < 1e-9 && Math.abs(ik.quatAngle(swing) - 0.4) < 1e-9);
});

// --- joint mapping --------------------------------------------------------------------------------
test('UAL skeleton maps to the full humanoid including fingers', () => {
	assert.deepEqual(mapping.missing, []);
	assert.equal(ual.skeleton.names[mapping.joints.upper_leg_l], 'thigh_l');
	assert.equal(ual.skeleton.names[mapping.joints.spine_3], 'spine_03');
	assert.equal(ual.skeleton.names[mapping.joints.index_2_r], 'index_02_r');
	assert.equal(mapping.joints.index_4_l, undefined);
});

test('naming conventions of the humanoid generator map to the same keys', () => {
	const keys = ik.humanoidJointKeys().filter((k) => k != 'root');
	const canonical = (key) => key.replace(/_([lr])$/, (_, s) => '.' + s.toUpperCase());
	const id_of = { spine_1: 'spine', spine_2: 'chest', spine_3: 'upper_chest', pelvis: 'hips', toes_l: 'toes.L', toes_r: 'toes.R', clavicle_l: 'shoulder.L', clavicle_r: 'shoulder.R' };
	for (const convention of ['simple', 'unity', 'godot', 'mixamo']) {
		const bone_names = keys.map((key) => names.boneName(id_of[key] ?? canonical(key), convention));
		const result = ik.mapHumanoidJoints(bone_names, bone_names.map(() => -1));
		const mapped = Object.keys(result.joints).filter((k) => !k.startsWith('spine_'));
		for (const key of keys.filter((k) => !k.startsWith('spine_'))) assert(mapped.includes(key), `${convention}: ${key} not mapped (${bone_names[keys.indexOf(key)]})`);
	}
});

// --- limb solver on a synthetic leg ---------------------------------------------------------------
function legSkeleton() {
	const t = (x, y, z) => ({ position: [x, y, z], rotation: [0, 0, 0, 1] });
	return new ik.Skeleton(['pelvis', 'hip', 'knee', 'foot', 'toe'], [-1, 0, 1, 2, 3], [t(0, 2, 0), t(0, 0, 0), t(0, -1, 0.0), t(0, -1, 0), t(0, 0, 0.3)]);
}
function legRig(skeleton) {
	const config = {
		version: 1, name: 'leg', forward: [0, 0, 1],
		goals: [{ id: 'foot', label: 'Foot', kind: 'foot', effector: 'foot', pole_joint: 'knee', mode: 'follow', position_weight: 1, rotation_weight: 0, pole_weight: 1 }],
		rules: [], solvers: [{ id: 'leg', kind: 'limb', enabled: true, weight: 1, goal: 'foot', root: 'hip', mid: 'knee', end: 'foot', softness: 0, min_interior_deg: 5, max_interior_deg: 180 }],
	};
	return new ik.IKRig(new ik.RigBinding(skeleton, config, { pelvis: 0, hip: 1, knee: 2, foot: 3, toe: 4 }));
}
test('limb solver reaches targets, keeps bone lengths and honours the pole', () => {
	const skeleton = legSkeleton();
	// bend the knee towards +Z first so the animation defines a pole
	const fk = new ik.Pose(skeleton);
	fk.rotateWorld(1, ik.quatFromAxisAngle([1, 0, 0], -0.5));
	fk.rotateWorld(2, ik.quatFromAxisAngle([1, 0, 0], 1.0));
	const rig = legRig(skeleton);
	const bend_before = fk.worldPosition(2)[2];
	for (const target of [[0.3, 0.6, 0.2], [-0.4, 0.2, 0.5], [0, 0.05, 0.1]]) {
		const goals = rig.extractGoals(fk);
		const override = new Map([['foot', { position: target }]]);
		const { pose } = rig.evaluate(fk, { time: 0, overrides: override });
		assert(ik.distance(pose.worldPosition(3), target) < 1e-6, 'foot reaches target');
		assert(Math.abs(ik.distance(pose.worldPosition(1), pose.worldPosition(2)) - 1) < 1e-9);
		assert(Math.abs(ik.distance(pose.worldPosition(2), pose.worldPosition(3)) - 1) < 1e-9);
		// the knee keeps bending forward (+z side of the hip -> foot line)
		const axis = ik.normalize(ik.sub(pose.worldPosition(3), pose.worldPosition(1)));
		const bend = ik.projectOnPlane(ik.sub(pose.worldPosition(2), pose.worldPosition(1)), axis);
		assert(ik.dot(bend, [0, 0, 1]) > 0, 'knee stays on the animated side');
		assert(goals.get('foot').pole_direction);
	}
	assert(bend_before > 0);
});
test('limb solver stretches straight towards unreachable targets without NaN', () => {
	const rig = legRig(legSkeleton());
	const { pose } = rig.evaluate(new ik.Pose(rig.binding.skeleton), { time: 0, overrides: new Map([['foot', { position: [0, -10, 3] }]]) });
	for (const joint of pose.world) assert(joint.position.every(Number.isFinite));
	const hip = pose.worldPosition(1);
	const foot = pose.worldPosition(3);
	assert(ik.distance(hip, foot) > 1.99);
	assert(ik.dot(ik.normalize(ik.sub(foot, hip)), ik.normalize(ik.sub([0, -10, 3], hip))) > 0.9999);
});
test('interior angle limit stops the knee from folding too far', () => {
	const rig = legRig(legSkeleton());
	rig.binding.config.solvers[0].min_interior_deg = 60;
	rig.rebuild();
	const { pose } = rig.evaluate(new ik.Pose(rig.binding.skeleton), { time: 0, overrides: new Map([['foot', { position: [0, 1.9, 0.01] }]]) });
	const a = ik.sub(pose.worldPosition(1), pose.worldPosition(2));
	const b = ik.sub(pose.worldPosition(3), pose.worldPosition(2));
	assert(ik.angleBetween(a, b) >= (60 * Math.PI) / 180 - 1e-6);
});
test('FABRIK reaches a target with a long chain and stretches when out of range', () => {
	const chain = [[0, 0, 0], [0, 1, 0], [0, 2, 0], [0, 3, 0], [0, 4, 0]];
	const reached = ik.fabrik(chain, [2, 2, 1], 50, 1e-4);
	assert(ik.distance(reached[4], [2, 2, 1]) < 1e-3);
	for (let i = 0; i < 4; i++) assert(Math.abs(ik.distance(reached[i], reached[i + 1]) - 1) < 1e-6);
	const far = ik.fabrik(chain, [0, 0, 20], 50, 1e-4);
	assert(Math.abs(far[4][2] - 4) < 1e-9);
});

// --- rig on real animation ------------------------------------------------------------------------
test('an untouched rig reproduces the source animation', () => {
	const rig = makeRig(ual.skeleton);
	for (const name of ['Walk_Loop', 'Idle_Loop']) {
		for (let t = 0; t <= clip(name).duration; t += 1 / 20) {
			const fk = ik.sampleClip(ual.skeleton, clip(name), t);
			const { pose } = rig.evaluate(fk, { time: t });
			for (let i = 0; i < fk.world.length; i++) assert(ik.distance(fk.world[i].position, pose.world[i].position) < 1e-3, `${name} joint ${ual.skeleton.names[i]} at ${t}`);
		}
	}
});

test('ground rule plants feet on stepped terrain and the body solver keeps legs reachable', () => {
	const rig = makeRig(ual.skeleton);
	const terrain = new ik.HeightFieldGround((x, z) => 0.12 * ik.smoothstep(z / 0.2), 0);
	const feet = ['foot_l', 'foot_r'];
	let lowered = false;
	for (const name of ['Idle_Loop', 'Walk_Loop']) {
		for (let t = 0; t <= clip(name).duration; t += 1 / 15) {
			const fk = ik.sampleClip(ual.skeleton, clip(name), t);
			const { pose, goals } = rig.evaluate(fk, { time: t, providers: { ground: terrain } });
			for (const id of feet) {
				const goal = goals.get(id);
				assert(ik.distance(pose.worldPosition(goal.effector), goal.position) < 1e-4, 'foot reaches its goal');
				const p = pose.worldPosition(goal.effector);
				const rest = ual.skeleton.bind_world[goal.effector].position[1] - rig.binding.ground_level;
				assert(p[1] - rest - terrain.sample(p[0], p[2]).height > -2e-3, 'foot never sinks into the terrain');
			}
			for (let i = 1; i < ual.skeleton.count; i++) {
				const parent = ual.skeleton.parents[i];
				if (parent < 0 || i == mapping.joints.pelvis || i == mapping.joints.root) continue;
				const before = ik.distance(fk.world[i].position, fk.world[parent].position);
				assert(Math.abs(before - ik.distance(pose.world[i].position, pose.world[parent].position)) < 1e-6, 'bone length preserved');
			}
			if (Math.abs(pose.worldPosition(mapping.joints.pelvis)[1] - fk.worldPosition(mapping.joints.pelvis)[1]) > 0.005) lowered = true;
		}
	}
	assert(lowered, 'pelvis moves with the terrain');
});

test('spine solver keeps the chest orientation when the pelvis is tilted by an offset foot', () => {
	const rig = makeRig(ual.skeleton);
	const fk = ik.sampleClip(ual.skeleton, clip('Idle_Loop'), 0);
	const chest = mapping.joints.spine_3;
	const { pose } = rig.evaluate(fk, { time: 0, overrides: new Map([['foot_l', { position: ik.add(fk.worldPosition(mapping.joints.foot_l), [0, 0.12, 0]) }]]) });
	const pelvis = mapping.joints.pelvis;
	assert(ik.quatAngle(ik.quatMul(pose.worldRotation(pelvis), ik.quatConjugate(fk.worldRotation(pelvis)))) > 0.01, 'pelvis tilted');
	assert(ik.quatAngle(ik.quatMul(pose.worldRotation(chest), ik.quatConjugate(fk.worldRotation(chest)))) < 1e-6, 'chest orientation kept');
});

test('look-at goal aims the head at a handle', () => {
	const rig = makeRig(ual.skeleton);
	const fk = ik.sampleClip(ual.skeleton, clip('Idle_Loop'), 0);
	const head = mapping.joints.head;
	const target = ik.add(fk.worldPosition(head), [0.6, 0.2, 0.8]);
	const handles = (id) => (id == 'look_at' ? { position: target, rotation: [0, 0, 0, 1], weight: 1, has_rotation: false } : null);
	const { pose } = rig.evaluate(fk, { time: 0, providers: { handles } });
	const axis = ik.quatRotate(ik.quatConjugate(ual.skeleton.bind_world[head].rotation), rig.binding.forward);
	const aim = ik.quatRotate(pose.worldRotation(head), axis);
	assert(ik.angleBetween(aim, ik.sub(target, pose.worldPosition(head))) < 0.01);
	// without handle the head is left alone
	const free = rig.evaluate(fk, { time: 0 }).pose;
	assert(ik.distance(free.worldPosition(head), fk.worldPosition(head)) < 1e-9);
});

test('attach rule holds a hand on a moving prop', () => {
	const rig = makeRig(ual.skeleton, mapping.joints, (config) => {
		config.rules.push({ id: 'grip', kind: 'attach', enabled: true, weight: 1, goal: 'hand_r', attachment: 'weapon', position: true, rotation: false, offset: [0, 0, 0] });
	});
	const fk = ik.sampleClip(ual.skeleton, clip('Idle_Loop'), 0);
	const anchor = ik.add(fk.worldPosition(mapping.joints.hand_r), [0.1, 0.1, 0.15]);
	const { pose } = rig.evaluate(fk, { time: 0, providers: { attachments: () => ({ position: anchor, rotation: [0, 0, 0, 1] }) } });
	assert(ik.distance(pose.worldPosition(mapping.joints.hand_r), anchor) < 1e-4);
});

// --- contacts and foot locking ----------------------------------------------------------------------
test('contact analysis finds stance phases and root motion', () => {
	const rig = makeRig(ual.skeleton);
	const rule = rig.binding.config.rules.find((r) => r.kind == 'foot_lock');
	const walk = ik.analyseContacts(rig.binding, rule, { sample: (t) => ik.sampleClip(ual.skeleton, clip('Walk_Loop'), t), duration: clip('Walk_Loop').duration, fps: 30 });
	assert(walk.has_root_motion);
	for (const id of ['foot_l', 'foot_r']) {
		const segments = walk.segmentsOf(id);
		assert(segments.length >= 1 && segments.length <= 3, `${id} has ${segments.length} segments`);
		for (const s of segments) assert(s.end - s.start > 0.1);
	}
	const idle = ik.analyseContacts(rig.binding, rule, { sample: (t) => ik.sampleClip(ual.skeleton, clip('Idle_Loop'), t), duration: clip('Idle_Loop').duration, fps: 30 });
	assert(!idle.has_root_motion);
});

// --- retargeting ------------------------------------------------------------------------------------
function stanceSlide(frames, source_clip) {
	const joints = [mapping.joints.foot_l, mapping.joints.foot_r];
	let total = 0; let count = 0;
	for (const joint of joints) {
		for (let k = 1; k < frames.length - 1; k++) {
			const dt = frames[k + 1].time - frames[k - 1].time;
			const before = ik.sampleClip(ual.skeleton, source_clip, frames[k - 1].time).worldPosition(joint);
			const after = ik.sampleClip(ual.skeleton, source_clip, frames[k + 1].time).worldPosition(joint);
			const now = ik.sampleClip(ual.skeleton, source_clip, frames[k].time).worldPosition(joint);
			if (now[1] > ual.skeleton.bind_world[joint].position[1] + 0.05 || ik.distance(before, after) / dt > 0.3) continue;
			const a = frames[k - 1].pose.worldPosition(joint);
			const b = frames[k + 1].pose.worldPosition(joint);
			total += Math.hypot(b[0] - a[0], b[2] - a[2]) / dt;
			count++;
		}
	}
	return total / count;
}

test('retargeting to different proportions keeps feet planted and limbs intact', () => {
	const walk = clip('Walk_Loop');
	const source_rig = makeRig(ual.skeleton);
	const target_skeleton = proportionedSkeleton({ lower_leg_l: 0.5, lower_leg_r: 0.5, foot_l: 0.9, foot_r: 0.9, toes_l: 0.9, toes_r: 0.9, lower_arm_l: 1.25, lower_arm_r: 1.25, hand_l: 1.25, hand_r: 1.25 });
	const target_rig = makeRig(target_skeleton);
	const source = clipSource(source_rig, walk);

	const fk_only = ik.retargetClip(source, target_rig, { fps: 30, solve_ik: false });
	const solved = ik.retargetClip(source, target_rig, { fps: 30 });
	assert.equal(solved.length, Math.round(walk.duration * 30) + 1);

	const slide_fk = stanceSlide(fk_only, walk);
	const slide_ik = stanceSlide(solved, walk);
	assert(slide_ik < slide_fk * 0.7, `IK retarget slides less than plain rotation transfer (${slide_ik.toFixed(3)} vs ${slide_fk.toFixed(3)})`);

	for (const frame of solved) {
		for (let i = 0; i < target_skeleton.count; i++) {
			assert(frame.pose.world[i].position.every(Number.isFinite));
			const parent = target_skeleton.parents[i];
			if (parent < 0 || i == mapping.joints.pelvis) continue;
			const expected = ik.distance(target_skeleton.bind_world[i].position, target_skeleton.bind_world[parent].position);
			assert(Math.abs(ik.distance(frame.pose.world[i].position, frame.pose.world[parent].position) - expected) < 1e-6, `${target_skeleton.names[i]}: ${ik.distance(frame.pose.world[i].position, frame.pose.world[parent].position)} vs ${expected}`);
		}
	}
});

test('retargeting handles a target that faces another direction', () => {
	const walk = clip('Walk_Loop');
	const source_rig = makeRig(ual.skeleton);
	// turn the whole target skeleton by 90 degrees around Y
	const bind = ual.skeleton.bind_local.map((t) => ({ position: [...t.position], rotation: [...t.rotation] }));
	const turn = ik.quatFromAxisAngle([0, 1, 0], Math.PI / 2);
	bind[0] = { position: ik.quatRotate(turn, bind[0].position), rotation: ik.quatMul(turn, bind[0].rotation) };
	const target_rig = makeRig(new ik.Skeleton(ual.skeleton.names, ual.skeleton.parents, bind));
	const frames = ik.retargetClip(clipSource(source_rig, walk), target_rig, { fps: 15 });
	const pelvis = mapping.joints.pelvis;
	const travel = ik.sub(frames[frames.length - 1].pose.worldPosition(pelvis), frames[0].pose.worldPosition(pelvis));
	const expected = ik.quatRotate(turn, ik.sub(ik.sampleClip(ual.skeleton, walk, walk.duration).worldPosition(pelvis), ik.sampleClip(ual.skeleton, walk, 0).worldPosition(pelvis)));
	assert(ik.distance(travel, expected) < 0.05, 'root motion rotated with the facing direction');
});

// --- keyframe reduction --------------------------------------------------------------------------------
test('track reduction keeps curve features and drops linear runs', () => {
	const times = Array.from({ length: 61 }, (_, i) => i / 30);
	const values = times.map((t) => [Math.abs(t - 1) * 40, 5]);
	const kept = ik.reduceTrack(times, values, 0.01);
	assert.deepEqual(kept, [0, 30, 60]);
	const sine = times.map((t) => [Math.sin(t * 4) * 30, 0]);
	const kept_sine = ik.reduceTrack(times, sine, 0.5);
	assert(kept_sine.length > 3 && kept_sine.length < times.length);
	for (let i = 0; i < times.length; i++) {
		const hi = kept_sine.findIndex((k) => k >= i);
		const lo = hi > 0 && kept_sine[hi] != i ? hi - 1 : hi;
		const a = kept_sine[lo], b = kept_sine[hi];
		const t = a == b ? 0 : (times[i] - times[a]) / (times[b] - times[a]);
		assert(Math.abs(sine[a][0] + (sine[b][0] - sine[a][0]) * t - sine[i][0]) <= 0.5 + 1e-9);
	}
});
test('angle unwrapping removes 360 degree jumps', () => {
	const unwrapped = ik.unwrapAngles([[170], [-175], [-170], [175]]);
	assert.deepEqual(unwrapped.map((v) => v[0]), [170, 185, 190, 175]);
});

test('procedural crouch and lean preserve foot targets and bone lengths across a walk', () => {
	const rig = makeRig(ual.skeleton, mapping.joints, config => {
		config.solvers.find(s => s.kind == 'body').crouch = 0.2;
		const spine = config.solvers.find(s => s.kind == 'spine');
		spine.lean_forward_deg = 15;
		spine.lean_side_deg = 5;
	});
	for (const t of [0, 0.2, 0.5, 0.8]) {
		const fk = ik.sampleClip(ual.skeleton, clip('Walk_Loop'), t);
		const { pose, goals } = rig.evaluate(fk, { time: t });
		assert(pose.worldPosition(mapping.joints.pelvis)[1] < fk.worldPosition(mapping.joints.pelvis)[1] - 0.1);
		for (const id of ['foot_l', 'foot_r']) {
			const goal = goals.get(id);
			assert(ik.distance(pose.worldPosition(goal.effector), goal.position) < 1e-4);
		}
		const chest = mapping.joints.spine_3;
		const delta = ik.quatMul(pose.worldRotation(chest), ik.quatConjugate(fk.worldRotation(chest)));
		assert(ik.quatAngle(delta) > 0.2, 'chest lean survives spine compensation');
		for (let joint = 0; joint < ual.skeleton.count; joint++) {
			const parent = ual.skeleton.parents[joint];
			if (parent < 0 || joint == mapping.joints.pelvis) continue;
			assert(Math.abs(ik.distance(pose.worldPosition(joint), pose.worldPosition(parent)) - ik.distance(fk.worldPosition(joint), fk.worldPosition(parent))) < 1e-6);
		}
	}
});

test('body reach correction fades continuously to zero and ignores disabled leg goals', () => {
	const rig = makeRig(ual.skeleton);
	const body = rig.binding.config.solvers.find(s => s.kind == 'body');
	const fk = ik.sampleClip(ual.skeleton, clip('Idle_Loop'), 0);
	const pelvis = mapping.joints.pelvis;
	const overrides = new Map(['foot_l', 'foot_r'].map(id => [id, { position: ik.add(fk.worldPosition(mapping.joints[id]), [0, -1, 0]) }]));
	body.weight = 1;
	const full = rig.evaluate(fk, { time: 0, overrides }).pose;
	body.weight = 0.001;
	const small = rig.evaluate(fk, { time: 0, overrides }).pose;
	assert(ik.distance(fk.worldPosition(pelvis), small.worldPosition(pelvis)) < ik.distance(fk.worldPosition(pelvis), full.worldPosition(pelvis)) * 0.002);
	body.weight = 1;
	for (const goal of rig.binding.config.goals) if (goal.kind == 'foot') goal.position_weight = 0;
	const ignored = rig.evaluate(fk, { time: 0, overrides }).pose;
	assert(ik.distance(ignored.worldPosition(pelvis), fk.worldPosition(pelvis)) < 1e-9);
	assert(ik.quatAngle(ik.quatMul(ignored.worldRotation(pelvis), ik.quatConjugate(fk.worldRotation(pelvis)))) < 1e-7);
});

test('motion rules are ordered, serializable and independent of scrubbing history', () => {
	const rig = makeRig(ual.skeleton, mapping.joints, config => {
		config.rules.push(
			{ id: 'sway', kind: 'oscillate', enabled: true, weight: 0.5, goal: 'hand_r', amplitude: [0, 0.1, 0], frequency: 1, phase: 0 },
			{ id: 'grip', kind: 'attach', enabled: true, weight: 1, goal: 'hand_r', attachment: 'prop', position: true, rotation: false, offset: [0, 0, 0] },
		);
	});
	const fk = ik.sampleClip(ual.skeleton, clip('Idle_Loop'), 0);
	const anchor = fk.worldPosition(mapping.joints.hand_r);
	const providers = { attachments: () => ({ position: anchor, rotation: [0, 0, 0, 1] }) };
	const before = JSON.stringify(fk.local);
	const at = time => rig.evaluate(fk, { time, providers });
	assert(ik.distance(at(0.25).goals.get('hand_r').position, anchor) < 1e-9, 'last attachment overrides sway');
	const rules = rig.binding.config.rules;
	rules.push(rules.splice(rules.findIndex(r => r.id == 'sway'), 1)[0]);
	rig.rebuild();
	const expected = at(0.25);
	assert(Math.abs(expected.goals.get('hand_r').position[1] - anchor[1] - 0.05) < 1e-9);
	at(0.8); at(0); at(0.5);
	assert.deepEqual(at(0.25).pose.local, expected.pose.local);
	assert.equal(JSON.stringify(fk.local), before, 'evaluation leaves the source pose intact');
	const restored = new ik.IKRig(new ik.RigBinding(ual.skeleton, JSON.parse(JSON.stringify(rig.binding.config)), mapping.joints));
	assert.deepEqual(restored.evaluate(fk, { time: 0.25, providers }).pose.local, expected.pose.local);
});
