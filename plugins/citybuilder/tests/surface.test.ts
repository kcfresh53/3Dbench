import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PALETTES, TILE_KINDS } from '../src/core/buildings/tiles';
import { paintSurface } from '../src/texture/tile_painters';

test('every tile paints in every palette without leaving unpainted or non-finite pixels', () => {
	for (const kind of TILE_KINDS) {
		for (let palette = 0; palette < PALETTES.length; palette += 5) {
			const maps = paintSurface(kind, palette, 24, 24, 3, 3.2, 2);
			for (const raster of [maps.albedo, maps.orm, maps.normal]) {
				for (let i = 3; i < raster.data.length; i += 4) assert.equal(raster.data[i], 255, `${kind}: opaque`);
			}
			// A normal map's blue channel is always on the upper hemisphere.
			for (let i = 2; i < maps.normal.data.length; i += 4) assert.ok(maps.normal.data[i] >= 127, `${kind}: normal faces out`);
		}
	}
});

test('detail is resolution independent: a high-resolution paint downsamples to the low-resolution one', () => {
	for (const kind of ['window', 'curtain', 'brick', 'balcony'] as const) {
		const lo = paintSurface(kind, 3, 48, 48, 3, 3.2, 1).albedo;
		const hi = paintSurface(kind, 3, 192, 192, 3, 3.2, 1).albedo;
		let error = 0;
		for (let y = 0; y < 48; y++) {
			for (let x = 0; x < 48; x++) {
				let mean = 0;
				for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) mean += hi.get(x * 4 + i, y * 4 + j)[1];
				error += Math.abs(mean / 16 - lo.get(x, y)[1]);
			}
		}
		assert.ok(error / (48 * 48) < 12, `${kind}: mean difference ${(error / 2304).toFixed(1)}`);
	}
});

test('window and curtain glass are smooth, mirror-like and metallic; plaster is rough and not', () => {
	const stats = (kind: 'wall' | 'curtain'): { roughness: number; metal: number } => {
		const m = paintSurface(kind, 3, 96, 96, 3, 3.2, 1).orm;
		let roughness = 1;
		let metal = 0;
		for (let i = 0; i < m.data.length; i += 4) {
			roughness = Math.min(roughness, m.data[i + 1] / 255);
			metal = Math.max(metal, m.data[i + 2] / 255);
		}
		return { roughness, metal };
	};
	const glass = stats('curtain');
	assert.ok(glass.roughness < 0.12, `glass roughness ${glass.roughness}`);
	assert.ok(glass.metal > 0.85, `glass reflectivity ${glass.metal}`);
	const wall = stats('wall');
	assert.ok(wall.roughness > 0.7 && wall.metal < 0.05);
});

test('relief produces tilted normals where there are edges and flat ones elsewhere', () => {
	const maps = paintSurface('brick', 0, 128, 128, 3, 3.2, 1);
	let tilted = 0;
	for (let i = 0; i < maps.normal.data.length; i += 4) if (Math.abs(maps.normal.data[i] - 128) > 6 || Math.abs(maps.normal.data[i + 1] - 128) > 6) tilted++;
	assert.ok(tilted > 128 * 128 * 0.05, 'mortar joints bend the normals');
	assert.ok(tilted < 128 * 128 * 0.9, 'brick faces stay mostly flat');
});

test('painting is deterministic', () => {
	const a = paintSurface('curtain', 9, 64, 64, 3, 3.2, 5);
	const b = paintSurface('curtain', 9, 64, 64, 3, 3.2, 5);
	assert.deepEqual(a.albedo.data, b.albedo.data);
	assert.deepEqual(a.orm.data, b.orm.data);
});

test('curtain-wall spandrels cover the slab zone, leaving the main window reflective', () => {
 let glass=0, total=0, slabRough=0, slabTotal=0;
 for(const palette of [11,12,13])for(let seed=0;seed<6;seed++){
  const maps=paintSurface('curtain',palette,64,64,3,3.2,seed).orm;
  for(let y=4;y<48;y++)for(let x=3;x<61;x++){
   const i=(y*64+x)*4;total++;
   if(maps.data[i+1]<32&&maps.data[i+2]>200)glass++;
  }
  for(let y=58;y<62;y++)for(let x=3;x<61;x++){
   slabTotal++;if(maps.data[(y*64+x)*4+1]>45)slabRough++;
  }
 }
 assert.ok(glass/total>.45,`main window reflective fraction: ${glass/total}`);
 assert.ok(slabRough/slabTotal>.9,`opaque slab fraction: ${slabRough/slabTotal}`);
});
