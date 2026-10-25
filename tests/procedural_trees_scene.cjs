// Isolated Electron integration check for the shipped tree generator.
const {app} = require('electron');
const {mkdtempSync, rmSync, writeFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {pathToFileURL} = require('node:url');
const profile = mkdtempSync(join(tmpdir(), '3dbench-trees-'));
process.argv.push('--userData', profile);
app.on('quit', () => rmSync(profile, {recursive:true, force:true}));
app.requestSingleInstanceLock = () => true;
let done = false;
app.on('browser-window-created', (_, win) => {
 win.webContents.on('console-message', (_, ...args) => { if (JSON.stringify(args).includes('Error')) console.log('TREE_RENDERER', JSON.stringify(args)); });
 win.webContents.on('did-finish-load', async () => {
  if (done) return; done = true;
  try {
   const result = await win.webContents.executeJavaScript(`(async () => {
    function check(condition, message) { if (!condition) throw Error(message); }
    async function until(fn) { for(let i=0;i<200;i++) { if(fn()) return; await new Promise(r=>setTimeout(r,25)); } throw Error('Generation timed out'); }
    await new Promise(resolve => requestAnimationFrame(resolve));
    check(Plugins.registered.procedural_trees?.source === 'builtin', 'Tree plugin not bundled');
    newProject(Formats.free);
    BarItems.procedural_tree.click();
    let dialog = open_interface;
    // First open must render before any preset or form interaction.
    check(!dialog.object.querySelector('.tree_stats').classList.contains('tree_error'), 'Initial dialog showed a preview error');
    await until(()=>dialog.object.querySelector('.tree_stats')?.textContent.includes('LOD0'));
    check(!dialog.object.querySelector('.tree_stats').classList.contains('tree_error'), 'Initial preview did not recover');
    dialog.setFormValues({preset:'oak_realistic',lodCount:3});
    await new Promise(r=>setTimeout(r,500));
    const canvas = dialog.object.querySelector('canvas');
    check(canvas && canvas.width > 0, 'Missing preview');
    dialog.setFormValues({branchCount:2});
    dialog.object.querySelector('.dialog_form_buttons button').click();
    check(dialog.getFormResult().branchCount===14, 'Reset shape to preset did not apply revised geometry');
    const firstAtlasCount = Texture.all.length;
    dialog.close(0);
    await until(()=>Texture.all.length > firstAtlasCount && !Undo.current_save);
    const tree = Group.all.find(g=>g.procedural_tree);
    check(tree && tree.children.length === 3, 'Missing LOD groups');
    check(Mesh.all.length === 6, 'Missing bark/foliage meshes');
    const metadata = JSON.parse(tree.procedural_tree);
    check(metadata.version === 2 && metadata.params.useBundledTextures, 'Photographic settings not saved');
    await until(()=>Texture.all[0]?.canvas.width === 1024);
    const pixels = Texture.all[0].ctx.getImageData(512,0,512,512).data;
    let transparent=0, opaque=0;
    for(let i=3;i<pixels.length;i+=4) { if(pixels[i]===0) transparent++; if(pixels[i]===255) opaque++; }
    check(transparent > 1000 && opaque > 1000, 'Leaf atlas lost its cutout alpha');
    const unusedFoliage = Texture.all[0].ctx.getImageData(512,512,512,512).data;
    check(unusedFoliage.every((value,index)=>index%4!==3 || value===0), 'Realistic card atlas still contains the unused old foliage texture');
    const gltf = JSON.parse(await Codecs.gltf.compile({encoding:'ascii',embed_textures:true,animations:false}));
    check(gltf.meshes.length === 6 && gltf.images.length === 1, 'glTF did not preserve six LOD meshes and one atlas');
    check(gltf.materials.some(m=>m.doubleSided && m.alphaMode === 'MASK'), 'glTF foliage lacks alpha clipping or double-sided rendering');
    const originalTexture = Texture.all[0].uuid;
    const originalMeshes = Mesh.all.map(m=>m.uuid).sort().join(',');
    const originalSettings = tree.procedural_tree;
    Undo.undo();
    check(!Mesh.all.length && !Texture.all.length && !Group.all.length, 'Creation undo left tree objects');
    Undo.redo();
    check(Mesh.all.length === 6 && Texture.all.length === 1, 'Creation redo failed');
    const restored = Group.all.find(g=>g.procedural_tree);
    restored.select();
    BarItems.edit_procedural_tree.click();
    dialog = open_interface;
    // A small embedded image is enough to verify persistence without filesystem dependencies.
    const sample = document.createElement('canvas'); sample.width=8; sample.height=8;
    sample.getContext('2d').fillRect(0,0,8,8);
    const image = sample.toDataURL();
    dialog.setFormValues({seed:17,barkImage:{name:'test.png',path:'test.png',content:image}});
    dialog.close(0);
    await until(()=>Texture.all[0]?.uuid !== originalTexture && !Undo.current_save);
    check(Texture.all.length === 1, 'Regeneration leaked old atlas');
    const saved = JSON.parse(restored.procedural_tree);
    check(saved.params.seed === 17 && saved.params.barkImage === image, 'Inputs not persisted');
    const project = Codecs.project.compile({raw:true});
    check(JSON.stringify(project).includes(image), 'Image absent from saved project');
    Undo.undo();
    check(Texture.all[0]?.uuid === originalTexture, 'Regeneration undo did not restore atlas');
    check(Mesh.all.map(m=>m.uuid).sort().join(',') === originalMeshes, 'Regeneration undo did not restore meshes');
    check(Group.all.find(g=>g.procedural_tree)?.procedural_tree === originalSettings, 'Regeneration undo lost settings');
    Undo.redo();
    Group.all.find(g=>g.procedural_tree).select();
    BarItems.edit_procedural_tree.click();
    dialog = open_interface;
    check(dialog.getFormResult().barkImage?.content === image, 'Reopened dialog lost embedded image');
    await until(()=>dialog.object.querySelector('.tree_stats')?.textContent.includes('LOD0'));
    check(!dialog.object.querySelector('.tree_stats').classList.contains('tree_error'), 'Edit dialog showed a preview error');
    dialog.close(1);
    newProject(Formats.free);
    Codecs.project.parse(project);
    await until(()=>Texture.all.length === 1 && Texture.all[0].canvas.width === 1024);
    Group.all.find(g=>g.procedural_tree).select();
    BarItems.edit_procedural_tree.click();
    check(open_interface.getFormResult().barkImage?.content === image, 'Saved/reloaded project lost texture inputs');
    open_interface.close(1);
    // A partial mesh construction failure must restore the original tree and atlas.
    const meshIds = Mesh.all.map(m=>m.uuid).sort().join(',');
    const textureId = Texture.all[0].uuid;
    const originalAddFaces = Mesh.prototype.addFaces;
    let injected = false;
    Mesh.prototype.addFaces = function(...args) { if(!injected) { injected=true; throw Error('Injected tree mesh failure'); } return originalAddFaces.apply(this,args); };
    try {
      Group.all.find(g=>g.procedural_tree).select();
      BarItems.edit_procedural_tree.click();
      open_interface.close(0);
      await until(()=>injected);
      await new Promise(r=>setTimeout(r,300));
      check(!Undo.current_save, 'Failure rollback left an open undo transaction');
      check(Mesh.all.map(m=>m.uuid).sort().join(',') === meshIds && Texture.all[0].uuid === textureId && Texture.all.length===1, 'Failed generation left partial objects');
      check(Group.all.length === 4, 'Failed generation left partial LOD groups');
    } finally { Mesh.prototype.addFaces = originalAddFaces; }
    newProject(Formats.free);
    BarItems.procedural_tree.click();
    open_interface.setFormValues({preset:'palm_realistic',lodCount:3,barkImage:'',leafImage:''});
    await until(()=>open_interface.object.querySelector('.tree_stats')?.textContent.includes('LOD2'));
    open_interface.close(0);
    await until(()=>Mesh.all.length===6 && !Undo.current_save);
    const palmGroup=Group.all.find(g=>g.procedural_tree);
    check(JSON.parse(palmGroup.procedural_tree).preset==='palm_realistic','Palm preset not saved');
    await until(()=>Texture.all[0]?.canvas.width===1024);
    const palmGltf=JSON.parse(await Codecs.gltf.compile({encoding:'ascii',embed_textures:true,animations:false}));
    check(palmGltf.meshes.length===6 && palmGltf.images.length===1,'Palm glTF export failed');
    palmGroup.select();
    BarItems.edit_procedural_tree.click();
    check(open_interface.getFormResult().leafKind==='palm','Palm regeneration settings lost');
    open_interface.close(1);
    BarItems.procedural_tree.click();
    open_interface.setFormValues({preset:'oak_realistic',barkImage:'',leafImage:''});
    await new Promise(r=>setTimeout(r,600));
    return {registration:'builtin', initialPreview:'renders without form interaction', lods:3, meshes:Mesh.all.length, textures:Texture.all.length, undo:'create/regenerate/redo and failure rollback passed', persistence:'embedded inputs survived project reload', export:'six glTF meshes, one atlas, two-sided alpha mask', palm:'three LODs, glTF and regeneration passed'};
   })()`);
   console.log('TREE_SCENE_RESULT', JSON.stringify(result));
   const shot = await win.webContents.capturePage();
   if (process.env.TREE_PREVIEW_PATH) writeFileSync(process.env.TREE_PREVIEW_PATH, shot.toPNG());
  } catch (error) { console.error('TREE_SCENE_FAILURE', error); process.exitCode = 1; }
  app.exit(process.exitCode || 0);
 });
});
setTimeout(()=>{console.error('TREE_SCENE_TIMEOUT');app.exit(1);},30000);
import(pathToFileURL(join(__dirname,'../electron/main.js')).href);
