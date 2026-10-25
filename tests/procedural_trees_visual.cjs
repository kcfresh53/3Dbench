// Visual review: render actual generator dialogs in an isolated desktop profile.
const {app} = require('electron');
const {mkdtempSync, rmSync, writeFileSync, mkdirSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join, resolve} = require('node:path');
const {pathToFileURL} = require('node:url');
const profile = mkdtempSync(join(tmpdir(), '3dbench-tree-review-'));
const seed = Number(process.env.TREE_REVIEW_SEED || 1);
const presets = (process.env.TREE_REVIEW_PRESETS || 'oak_realistic,pine_realistic,birch_realistic,bush_realistic,oak_stylized,dead_realistic,palm_realistic,palm_stylized').split(',');
const output = resolve(process.env.TREE_REVIEW_DIR || '.scratch/tree-review');
mkdirSync(output,{recursive:true});
process.argv.push('--userData', profile);
app.on('quit',()=>rmSync(profile,{recursive:true,force:true}));
app.requestSingleInstanceLock=()=>true;
let done=false;
app.on('browser-window-created',(_,win)=>{
 win.webContents.on('did-finish-load', async()=>{
  if(done)return;done=true;
  try {
   await win.webContents.executeJavaScript(`newProject(Formats.free)`);
   for(const preset of presets) {
    const rect = await win.webContents.executeJavaScript(`(async()=>{
     BarItems.procedural_tree.click();
     open_interface.setFormValues({preset:${JSON.stringify(preset)},seed:${JSON.stringify(seed)},lodCount:1,barkImage:'',leafImage:''});
     await new Promise(r=>setTimeout(r,1000));
     const rect=open_interface.object.querySelector('canvas').getBoundingClientRect();
     return {x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)};
    })()`);
    writeFileSync(join(output,preset+'.png'),(await win.webContents.capturePage(rect)).toPNG());
    await win.webContents.executeJavaScript(`open_interface.close(1)`);
   }
   console.log('TREE_VISUAL_REVIEW',output);
  } catch(error) {console.error(error);process.exitCode=1;}
  app.exit(process.exitCode||0);
 });
});
setTimeout(()=>app.exit(1),30000);
import(pathToFileURL(join(__dirname,'../electron/main.js')).href);
