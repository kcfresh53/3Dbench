// Run with Electron after build-electron. Uses a temporary editor profile.
const { app } = require('electron');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const profile = mkdtempSync(join(tmpdir(), '3dbench-humanoid-scene-'));
process.argv.push('--userData', profile);
app.on('quit', () => rmSync(profile, { recursive: true, force: true }));
app.requestSingleInstanceLock = () => true;
let done = false;
app.on('browser-window-created', (_, win) => {
 win.webContents.on('did-finish-load', async () => {
  if (done) return; done = true;
  try {
   win.webContents.on('console-message', async (_, ...args) => {
    const message = args.map(arg => typeof arg === 'string' ? arg : arg?.message).find(text => text?.startsWith('HUMANOID_TEST_CAPTURE '));
    if (!message) return;
    const rect = JSON.parse(message.slice('HUMANOID_TEST_CAPTURE '.length));
    const png = (await win.webContents.capturePage(rect)).toPNG();
    if (process.env.HUMANOID_SCREENSHOT) writeFileSync(process.env.HUMANOID_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
    const hash = require('node:crypto').createHash('sha256').update(png).digest('hex');
    await win.webContents.executeJavaScript('window.__humanoidTestCapture('+JSON.stringify(hash)+')');
   });
   const result = await win.webContents.executeJavaScript(`(async () => {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const format = Object.values(Formats).find(f => f.armature_rig && f.meshes);
    if (!format) throw Error('No rigged mesh format');
    const results = [];
    const waitFor = async (predicate, message) => {
     for(let i=0;i<200;i++) { if(predicate()) return; await new Promise(r=>setTimeout(r,25)); }
     throw Error(message);
    };
    const capture = async () => {
     await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
     const rect = open_interface.object.querySelector('canvas').getBoundingClientRect();
     return new Promise(resolve => {
      window.__humanoidTestCapture = resolve;
      console.log('HUMANOID_TEST_CAPTURE '+JSON.stringify({x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)}));
     });
    };
    newProject(format);
    const beforeUndo = Undo.history.length;
    BarItems.create_humanoid.click();
    let cancelled = open_interface;
    await waitFor(()=>cancelled.object.querySelector('canvas').dataset.vertices==='5796','Initial preview missing');
    cancelled.setFormValues({body_type:2.7});
    cancelled.close(cancelled.cancelIndex);
    await new Promise(r=>setTimeout(r,150));
    if(Mesh.all.length || Undo.history.length!==beforeUndo) throw Error('Cancelled preview changed the scene or undo');

    for (const sex of ['male', 'female']) {
     newProject(format);
     BarItems.create_humanoid.click();
     const dialog = open_interface;
     dialog.setFormValues({ preset: sex });
     dialog.setFormValues({ body_type: 1.65, hip_fullness: 0.5, breast_size: sex === 'female' ? 0.5 : 0, include_ears: true, single_mesh: true, height: 48 });
     const canvas = dialog.object.querySelector('canvas');
     const status = dialog.object.querySelector('.humanoid_stats');
     await waitFor(()=>canvas.dataset.vertices===(sex==='male'?'5796':'5586') && !status.textContent.includes('Updating'),'Preview did not load');
     // Exercise real range-input events, not just programmatic form values.
     for (const [key, value] of [['head_size',1.25],['body_size',1.2],['shoulder_size',0.8],['shortness',0.3],['arm_size',0.8],['leg_size',1.15],['hip_fullness',0.7], ...(sex==='female'?[['breast_size',0.7]]:[])]) {
      const input = dialog.object.querySelector('.form_bar_'+key+' input[type=range]');
      if(!input) throw Error('Missing visible slider '+key);
      const previous = await capture();
      input.value = value;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      await waitFor(()=>!status.textContent.includes('Updating'),'Slider did not finish updating: '+key);
      if(await capture()===previous) throw Error('Slider did not change mesh: '+key);
     }
     const before = await capture();
     canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:-300,cancelable:true}));
     if(await capture()===before) throw Error('Preview zoom did not change the viewport');
     canvas.dispatchEvent(new MouseEvent('dblclick'));
     dialog.setFormValues({generate_mesh:false});
     await waitFor(()=>canvas.dataset.vertices==='0' && !status.textContent.includes('Updating'),'Skeleton-only preview missing');
     dialog.setFormValues({generate_mesh:true});
     await waitFor(()=>canvas.dataset.vertices===(sex==='male'?'5796':'5586') && !status.textContent.includes('Updating'),'Body preview did not return');
     dialog.setFormValues({body_type:2.7,include_ears:false});
     await waitFor(()=>canvas.dataset.vertices===(sex==='male'?'5466':'5256') && !status.textContent.includes('Updating'),'Live edit did not update');
     if(await capture()===before) throw Error('Preview pixels unchanged after editing');
     // Restore the intended final settings, including ears, before adding.
     dialog.setFormValues({body_type:1.65,include_ears:true});
     await waitFor(()=>canvas.dataset.vertices===(sex==='male'?'5796':'5586') && !status.textContent.includes('Updating'),'Restored preview missing');
     if(Mesh.all.length || Undo.history.length) throw Error('Preview mutated project');
     await capture();
     const values = dialog.getFormResult();
     if (values.body_type !== 1.65 || values.preset !== sex) throw Error('Dialog values lost');
     dialog.close(dialog.confirmIndex);
     for (let i=0; i<200 && !Mesh.all.length; i++) await new Promise(resolve=>setTimeout(resolve,25));
     if (Mesh.all.length !== 1) throw Error('Expected merged mesh for '+sex);
     const mesh = Mesh.all[0];
     const vertices = Object.values(mesh.vertices);
     if (vertices.length < 5000 || Math.abs(Math.max(...vertices.map(v=>v[1]))-48)>1e-6) throw Error('Character geometry/height mismatch');
     if (!Object.values(mesh.faces).every(f=>f.getSortedVertices().every(k=>Array.isArray(f.uv[k])))) throw Error('Missing scene UVs');
     const count = vertices.length;
     Undo.undo();
     if (Mesh.all.length) throw Error('Undo did not remove character');
     Undo.redo();
     if (Mesh.all.length !== 1 || Object.keys(Mesh.all[0].vertices).length !== count) throw Error('Redo did not restore character');
     results.push({sex,vertices:count,livePreview:true,cancel:true,undo:true,redo:true});
     Project.saved = true;
    }
    return results;
   })()`);
   console.log('HUMANOID_SCENE_RESULT', JSON.stringify(result));
   app.exit(0);
  } catch (error) { console.error('HUMANOID_SCENE_FAILURE', error); app.exit(1); }
 });
});
setTimeout(() => { console.error('HUMANOID_SCENE_TIMEOUT'); app.exit(1); }, 30000);
import(pathToFileURL(join(__dirname, '../electron/main.js')).href);
