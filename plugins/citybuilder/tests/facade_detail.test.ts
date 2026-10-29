import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildModel} from '../src/core/buildings/massing';
import {modularMesh} from '../src/core/buildings/mesh';
import {specFor} from './helpers';
import {tileKind} from '../src/core/buildings/tiles';

test('close-range facades have source geometry, recessed glass and lighter distant proxies',()=>{
 const model=buildModel({...specFor('office_tower',20),shape:'chamfered',nx:6,nz:6});
 assert.ok(model.facades.some(r=>r.rows.some(row=>row.nativeDetail)));
 const fine=modularMesh(model,0),middle=modularMesh(model,1);
 assert.ok(fine.faces.length>middle.faces.length*3);
 const glass=model.pieces.filter(p=>tileKind(p.tile)==='glass_tower');
 assert.ok(glass.length>20);
 assert.ok(glass.every(p=>p.maxLod===0));
 assert.ok(glass.every(p=>p.normals?.every(n=>Math.abs(Math.hypot(...n)-1)<1e-5)));
 const front=glass.filter(p=>p.normals![0][2]<-.9);
 assert.ok(front.length>0);
 // The camera sees actual panes behind frames, rather than a single facade quad at z = -depth/2.
 assert.ok(front.some(p=>p.corners.some(v=>v[2]>-model.depth/2+.05)));
});
