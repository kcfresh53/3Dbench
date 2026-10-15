// Run with Electron after npm run build-electron. Uses an isolated temporary profile.
const {app} = require('electron');
const {mkdtempSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {pathToFileURL} = require('node:url');
const profile = mkdtempSync(join(tmpdir(), '3dbench-builtins-'));
process.argv.push('--userData', profile);
app.on('quit', () => rmSync(profile, {recursive:true, force:true}));
// Avoid forwarding the test launch to an already running editor.
app.requestSingleInstanceLock = () => true;
let done = false;
app.on('browser-window-created', (_, win) => {
 win.webContents.on('console-message', (_, ...args) => { const text = JSON.stringify(args); if (/Failed to initialize|ReferenceError|TypeError|Uncaught/.test(text)) console.log('RENDERER', text); });
 win.webContents.on('did-finish-load', async () => {
  if(done) return; done = true;
  try {
   const result = await win.webContents.executeJavaScript(`(async () => {
    const ids = ['easing_peasy','optimize','gltf_importer'];
    const status = ids.map(id => ({id, source: Plugins.registered[id]?.source, installed: Plugins.registered[id]?.installed}));
    if (!Blockbench.setup_successful || status.some(p => p.source !== 'builtin' || !p.installed)) throw Error(JSON.stringify(status));
    if (!BarItems.optimize || !BarItems.import_gltf || !Panels['easing_peasy:panel/easings'] || !Keyframe.properties.easing) throw Error('Missing feature registration');
    // Let Vue finish its first render before opening a model.
    await new Promise(resolve => requestAnimationFrame(resolve));
    newProject(Formats.free);
    const a = new Cube({from:[0,0,0],to:[8,8,8]}).init();
    const b = new Cube({from:[8,0,0],to:[16,8,8]}).init();
    new Mesh({name:'Must survive optimization'}).init();
    BarItems.optimize.click();
    open_interface.onConfirm({});
    if(a.faces.east.texture !== null || b.faces.west.texture !== null || Mesh.all.length !== 1) throw Error('Optimization did not hide shared faces or preserve mesh');
    Undo.undo();
    if(Cube.all.some(c => Object.values(c.faces).some(f=>f.texture === null))) throw Error('Undo failed');
    const animator = new BoneAnimator(guid(), new Animation(), 'test');
    const k1 = new Keyframe({channel:'position',time:0,data_points:[{x:0,y:0,z:0}]}, undefined, animator);
    const k2 = new Keyframe({channel:'position',time:1,easing:'easeInQuad',data_points:[{x:8,y:0,z:0}]}, undefined, animator);
    if (Math.abs(k1.getLerp(k2, 'x', 0.5) - 2) > 1e-6) throw Error('Easing interpolation failed');
    if(k2.getUndoCopy().easing !== 'easeInQuad') throw Error('Easing serialization failed');
    for(const id of ids) {
      const p = Plugins.registered[id];
      p.toggleDisabled(); p.uninstall(); p.installUpdate();
      if(Plugins.registered[id] !== p || p.disabled || !p.installed) throw Error('Built-in can be disabled or replaced');
    }
    const buffer = new Float32Array([0,0,0, 1,0,0, 0,1,0]);
    const gltf = {asset:{version:'2.0'}, buffers:[{uri:'data:application/octet-stream;base64,'+Buffer.from(buffer.buffer).toString('base64'),byteLength:36}],bufferViews:[{buffer:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}], meshes:[{primitives:[{attributes:{POSITION:0}}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};
    await importGltf({file:{path:'/tmp/triangle.gltf',content:JSON.stringify(gltf)},scale:16,groups:true,animations:false,cameras:false,mergeQuads:false,undoable:true,selectResult:true});
    if(Mesh.all.length !== 2 || !Mesh.all.some(m=>Object.keys(m.vertices).length===3)) throw Error('glTF triangle missing');
    return {status, optimize:'shared faces hidden; mixed mesh preserved; undo passed', gltf:'triangle imported', easing:'panel, interpolation, and serialization passed'};
   })()`);
   console.log('SMOKE_RESULT',JSON.stringify(result));
  } catch (err) { console.error('SMOKE_FAILURE', err); process.exitCode=1; }
  app.exit(process.exitCode || 0);
 });
});
setTimeout(()=>{console.error('SMOKE_TIMEOUT');app.exit(1)},20000);
import(pathToFileURL(join(__dirname, '../electron/main.js')).href);
