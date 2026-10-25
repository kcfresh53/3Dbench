import assert from 'node:assert/strict';
import { generateTreeSet } from '../src/core/tree_generator';
import { PRESET_LOOKS, PRESET_NAMES, presetParams } from '../src/ui/presets';
import { REGION_BARK, REGION_LEAF_CARD, REGION_SOLID } from '../src/core/uv_layout';
import type { Region } from '../src/core/uv_layout';
import type { MeshData, MeshFaceData, TreeLod, TreeParams, Vec2 } from '../src/core/types';

function inside(uv: Vec2, r: Region): boolean {
	const e = 1e-6;
	return uv[0] >= r.x - e && uv[0] <= r.x + r.w + e && uv[1] >= r.y - e && uv[1] <= r.y + r.h + e;
}

function uvArea(face: MeshFaceData): number {
	let area = 0;
	for (let i = 1; i < face.uvs.length - 1; i++) {
		const a: Vec2 = face.uvs[0];
		const b: Vec2 = face.uvs[i];
		const c: Vec2 = face.uvs[i + 1];
		area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
	}
	return area;
}

function checkMesh(label: string, data: MeshData, allowed: Region[]): void {
	for (const face of data.faces) {
		assert.ok(face.indices.length === 3 || face.indices.length === 4, `${label}: tri or quad`);
		assert.equal(face.uvs.length, face.indices.length, `${label}: uv count`);
		for (const i of face.indices) assert.ok(i >= 0 && i < data.positions.length, `${label}: index in range`);
		assert.ok(
			face.uvs.every((uv: Vec2): boolean => allowed.some((r: Region): boolean => inside(uv, r))),
			`${label}: every UV stays inside one atlas region`,
		);
		assert.ok(
			allowed.some((r: Region): boolean => face.uvs.every((uv: Vec2): boolean => inside(uv, r))),
			`${label}: a face never straddles two regions`,
		);
	}
	for (const p of data.positions) assert.ok(p.every(Number.isFinite), `${label}: finite positions`);
}

for (const name of PRESET_NAMES) {
	const params: TreeParams = presetParams(name);
	const lods: TreeLod[] = generateTreeSet({ ...params, lodCount: 3 });
	assert.equal(lods.length, 3);
	lods.forEach((lod: TreeLod, i: number): void => {
		checkMesh(`${name} lod${i} trunk`, lod.trunk, [REGION_BARK]);
		checkMesh(`${name} lod${i} foliage`, lod.foliage, [REGION_LEAF_CARD, REGION_SOLID]);
		assert.ok(lod.withinBudget, `${name} lod${i} within budget (${lod.triangles})`);
	});
	assert.ok(lods[0].triangles >= lods[2].triangles, `${name}: LODs shrink`);

	// The old bug: solid-foliage faces sampled a few pixels. Each must now cover a real window.
	const solidFaces: MeshFaceData[] = lods[0].foliage.faces.filter((f: MeshFaceData): boolean =>
		f.uvs.every((uv: Vec2): boolean => inside(uv, REGION_SOLID)),
	);
	for (const face of solidFaces) {
		const a: number = uvArea(face);
		assert.ok(a > (name.startsWith('palm_') ? 0 : 0.0015), `${name}: solid foliage face UV area ${a.toFixed(5)} is too small`);
	}
	console.log(
		name.padEnd(16),
		lods.map((l: TreeLod): number => l.triangles).join(' / '),
		'tris',
		solidFaces.length ? `(${solidFaces.length} solid-UV faces)` : '',
	);
}

// Determinism and seed sensitivity
const a: TreeLod[] = generateTreeSet(presetParams('oak_stylized'));
const b: TreeLod[] = generateTreeSet(presetParams('oak_stylized'));
assert.deepEqual(a[0].trunk.positions, b[0].trunk.positions);
const c: TreeLod[] = generateTreeSet({ ...presetParams('oak_stylized'), seed: 99 });
assert.notDeepEqual(a[0].trunk.positions, c[0].trunk.positions);

// Tight budget is honoured
const tight: TreeLod[] = generateTreeSet({ ...presetParams('oak_realistic'), maxTriangles: 400 });
assert.ok(tight[0].triangles <= 400, `tight budget (${tight[0].triangles})`);

// Realistic is richer than stylized at default budgets
assert.ok(
	generateTreeSet(presetParams('oak_realistic'))[0].triangles > generateTreeSet(presetParams('oak_stylized'))[0].triangles,
	'realistic oak has more detail than stylized oak',
);

// Dead trees have no foliage; stylized pine uses tiers, realistic pine uses needle cards
assert.equal(generateTreeSet(presetParams('dead_stylized'))[0].foliage.faces.length, 0);
assert.equal(generateTreeSet(presetParams('dead_realistic'))[0].foliage.faces.length, 0);
assert.equal(PRESET_LOOKS.pine_stylized.foliageStyle, 'tiers');
assert.equal(PRESET_LOOKS.pine_realistic.leafKind, 'needle');

console.log('All tree generator tests passed.');

// Form boundaries prevent non-finite or out-of-range editor input from entering generation.
const { readParams, buildForm } = await import('../src/ui/form_adapter');
const original = presetParams('oak_realistic');
const slots = { barkImage: 'data:image/png;base64,test', leafImage: '' };
const parsed = readParams({ height: NaN, branchCount: 1000, trunkSides: -10, textureSize: '999999', foliageStyle: 'invalid' }, original, slots);
assert.equal(parsed.height, original.height);
assert.equal(parsed.branchCount, 20);
assert.equal(parsed.trunkSides, 3);
assert.equal(parsed.textureSize, original.textureSize);
assert.equal(parsed.foliageStyle, original.foliageStyle);
assert.equal(readParams({ barkImage: undefined }, original, slots).barkImage, '');
assert.equal(readParams({ barkImage: {content:slots.barkImage} }, original, slots).barkImage, slots.barkImage);
const form = buildForm({...original,...slots}, 'oak_realistic');
assert.equal(((form.barkImage as {value:{content:string}}).value).content, slots.barkImage);

// Existing version-1 trees keep their previous paint when edited; new inputs round-trip.
const { readStoredTree } = await import('../src/blockbench/bridge');
const legacy = readStoredTree({procedural_tree:JSON.stringify({version:1,preset:'oak_realistic',params:original})} as never);
assert.equal(legacy?.params.useBundledTextures, false);
const modern = readStoredTree({procedural_tree:JSON.stringify({version:2,preset:'oak_realistic',params:{...original,...slots}})} as never);
assert.equal(modern?.params.barkImage, slots.barkImage);
assert.equal(readStoredTree({procedural_tree:'{'} as never), null);
assert.equal(readStoredTree({procedural_tree:JSON.stringify({version:2,preset:'missing',params:{}})} as never), null);
console.log('Form validation and saved-settings regression tests passed.');

// Engine LODs share the root origin; optional editing layout only translates X.
const aligned = generateTreeSet({...presetParams('oak_realistic'), lodCount:3, spreadLods:false});
const spaced = generateTreeSet({...presetParams('oak_realistic'), lodCount:3, spreadLods:true});
for (let i=0;i<3;i++) {
 assert.equal(aligned[i].trunk.positions[0][0], aligned[0].trunk.positions[0][0]);
 assert.deepEqual(aligned[i].trunk.faces, spaced[i].trunk.faces);
 assert.equal(aligned[i].triangles, spaced[i].triangles);
 if (i) assert.ok(spaced[i].trunk.positions[0][0] > aligned[i].trunk.positions[0][0]);
}

// Lower budgets prune the same skeleton instead of rerolling the tree's silhouette.
const { growSkeleton } = await import('../src/core/skeleton');
const { Rng } = await import('../src/core/rng');
const fullSkeleton = growSkeleton(presetParams('oak_realistic'), 1, new Rng(23));
const lowSkeleton = growSkeleton(presetParams('oak_realistic'), 0.3, new Rng(23));
for (const branch of lowSkeleton) {
 assert.ok(fullSkeleton.some(candidate => JSON.stringify(candidate.points) === JSON.stringify(branch.points)), 'retained LOD branch must keep its path');
}
// Cards must occupy varied 3D planes, rather than a stack of vertical rectangles.
let tilted = 0;
const mesh = generateTreeSet(presetParams('oak_realistic'))[0].foliage;
for (const face of mesh.faces) {
 const [a,b,c] = face.indices.slice(0,3).map(i=>mesh.positions[i]);
 const ux=b[0]-a[0], uy=b[1]-a[1], uz=b[2]-a[2];
 const vx=c[0]-a[0], vy=c[1]-a[1], vz=c[2]-a[2];
 const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
 if(Math.abs(ny)/Math.hypot(nx,ny,nz)>0.3) tilted++;
}
assert.ok(tilted > 50, 'canopy needs leaves in varied planes');
console.log('Stable branch paths and volumetric foliage checks passed.');

// Restoring the stylized look must not change accepted realistic geometry/settings.
const { createHash } = await import('node:crypto');
const { REALISTIC_HASHES } = await import('./realistic_appearance');
for (const name of PRESET_NAMES.filter(name => name.endsWith('_realistic') && !name.startsWith('palm_'))) {
 for (const seed of [1,42]) {
  const params = {...presetParams(name),seed,lodCount:3};
  const digest = createHash('sha256').update(JSON.stringify({params,lods:generateTreeSet(params)})).digest('hex');
  assert.equal(digest, REALISTIC_HASHES[(name+seed) as keyof typeof REALISTIC_HASHES], `${name} seed ${seed}: accepted realistic output unchanged`);
 }
}
const oldStylizedCounts = {
 oak_stylized: [678,574,258], pine_stylized:[71,71,71], birch_stylized:[385,385,251],
 bush_stylized:[1195,505,232], dead_stylized:[400,400,242],
};
for (const name of Object.keys(oldStylizedCounts) as Array<keyof typeof oldStylizedCounts>) {
 assert.deepEqual(generateTreeSet({...presetParams(name),lodCount:3}).map(lod=>lod.triangles), oldStylizedCounts[name]);
}
assert.equal(presetParams('oak_stylized').foliageStyle,'cards');
assert.equal(presetParams('birch_stylized').foliageStyle,'cards');
console.log('Original stylized presets restored; accepted realistic output unchanged.');

// Palm crowns stay above the bare stem and contain explicit tapered leaflets.
for (const name of ['palm_realistic','palm_stylized'] as const) {
 const p=presetParams(name);
 const lods=generateTreeSet({...p,lodCount:3});
 assert.ok(lods[0].foliage.positions.every(position=>position[1]>p.height*0.55), `${name}: crown must not run down the trunk`);
 assert.ok(lods[0].foliage.faces.some(face=>face.indices.length===3), `${name}: tapered leaflet geometry`);
 assert.ok(lods[0].triangles>lods[1].triangles && lods[1].triangles>lods[2].triangles, `${name}: each LOD removes detail`);
 assert.deepEqual(generateTreeSet(p),generateTreeSet(p), `${name}: deterministic`);
 assert.notDeepEqual(generateTreeSet(p)[0].trunk.positions,generateTreeSet({...p,seed:42})[0].trunk.positions, `${name}: seed variation`);
 assert.equal(generateTreeSet({...p,foliageStyle:'none'})[0].foliage.faces.length,0);
 const tightPalm=generateTreeSet({...p,maxTriangles:400})[0];
 assert.ok(tightPalm.withinBudget && tightPalm.triangles<=400,`${name}: tight budget`);
}
console.log('Palm crown, LOD, seed and budget checks passed.');
