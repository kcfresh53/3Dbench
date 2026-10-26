// Integration checks against the real renderer, using a disposable desktop profile.
const {app} = require('electron');
const {mkdtempSync, rmSync, mkdirSync, writeFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join, resolve} = require('node:path');
const {pathToFileURL} = require('node:url');
const profile = mkdtempSync(join(tmpdir(), '3dbench-material-ui-'));
const output = resolve('.scratch/material-ui');
mkdirSync(output, {recursive: true});
process.argv.push('--userData', profile);
app.requestSingleInstanceLock = () => true;
app.on('quit', () => rmSync(profile, {recursive: true, force: true}));
let started = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.on('browser-window-created', (_, win) => {
 win.webContents.on('did-finish-load', async () => {
  if (started) return;
  started = true;
  const run = async fn => {
   const result = await win.webContents.executeJavaScript(`(async()=>{try{return {value:await (${fn.toString()})()}}catch(error){return {error:error.stack}}})()`);
   if (result.error) throw new Error(result.error);
   return result.value;
  };
  const capture = async name => {
   await delay(350);
   writeFileSync(join(output, name+'.png'), (await win.webContents.capturePage()).toPNG());
  };
  try {
   win.setMinimumSize(360,400);
   win.setSize(1512, 947);
   await run(() => { newProject(Formats.free); new Cube({name:'Layout inspection'}).init().select(); });
   await delay(500);
   await run(() => {
    window.uiAssert = (value, message) => {if (!value) throw new Error(message);};
    window.uiRect = node => node.getBoundingClientRect();
    window.uiOriginalWidths = JSON.stringify([Interface.data.left_bar_width, Interface.data.right_bar_width]);
    for (const node of document.querySelectorAll('.sidebar .toolbar_menu, .preview_menu .tool, .panel_tab_bar > .panel_control, .panel_menu_button')) {
     if (!node.offsetWidth) continue;
     const box=uiRect(node), icon=uiRect(node.querySelector('i'));
     uiAssert(box.width>=36 && box.height>=36, 'Undersized icon target: '+node.className);
     uiAssert(Math.abs(box.x+box.width/2-icon.x-icon.width/2)<1, 'Icon is not horizontally centered: '+node.className);
     uiAssert(Math.abs(box.y+box.height/2-icon.y-icon.height/2)<1, 'Icon is not vertically centered: '+node.className);
    }
    const resolution=uiRect(document.querySelector('#uv_resolution_status'));
    const expand=uiRect(document.querySelector('.panel_expanding_button'));
    uiAssert(resolution.right<=expand.left, 'UV resolution overlaps the expand control');
    uiAssert(uiRect(document.querySelector('.outliner_object')).height===32, 'Outliner target is too small');
   });
   await capture('workspace');
   await run(() => { settings.interface_density.set('comfortable'); });
   await delay(200);
   await run(() => {
    uiAssert(uiRect(document.querySelector('.outliner_object')).height===48,'Comfortable density does not restore targets');
    uiAssert([...document.querySelectorAll('.panel_control')].filter(n=>n.offsetWidth).every(n=>uiRect(n).height===48),'Comfortable panel control target');
    settings.interface_density.set('compact');
   });

   for (const width of [1080, 800, 640]) {
    win.setSize(width, width===640 ? 480 : 800);
    await delay(350);
    await run(() => {
     const work=uiRect(document.querySelector('#work_screen'));
     const toolbar=uiRect(document.querySelector('#main_toolbar'));
     const modes=uiRect(document.querySelector('#mode_selector'));
     const center=uiRect(document.querySelector('#center'));
     uiAssert(toolbar.right<=work.right && modes.right<=toolbar.right, 'Toolbar exceeds available width');
     uiAssert(center.width>=320, 'Supporting panes crowd out the canvas');
     for (const bar of document.querySelectorAll('.sidebar')) {
      if (bar.offsetWidth) uiAssert(uiRect(bar).right<=work.right, 'Supporting pane exceeds window');
     }
    });
    await capture('width-'+width);
   }
   await run(() => {
    Interface.toggleSidebar('left');
    uiAssert(Interface.left_bar_width>0 && Interface.right_bar_width===0, 'Compact supporting pane cannot be switched');
    Interface.toggleSidebar('right');
   });
   win.setSize(1512,947); await delay(350);
   await run(async () => {
    uiAssert(Interface.left_bar_width>0 && Interface.right_bar_width>0, 'Expanded panes did not restore');
    uiAssert(JSON.stringify([Interface.data.left_bar_width,Interface.data.right_bar_width])===uiOriginalWidths, 'Responsive fitting changed saved pane widths');
    const fold=UVEditor.panel.tab_bar.querySelector('.panel_folding_button');
    fold.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));
    uiAssert(UVEditor.panel.folded && fold.getAttribute('aria-expanded')==='false', 'Keyboard collapse failed');
    await new Promise(resolve=>setTimeout(resolve,80));
    fold.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await new Promise(resolve=>setTimeout(resolve,550));
    uiAssert(!UVEditor.panel.folded && !document.querySelector('.bench_folding'), 'Interrupted fold did not finish cleanly');
    const paint=[...document.querySelectorAll('#mode_selector li')][1];
    paint.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    uiAssert(Modes.selected.id==='paint', 'Keyboard mode selection failed');
   });
   await capture('paint');
   await run(() => { Modes.options.animate.select(); uiAssert(Modes.selected.id==='animate','Animation mode did not open');
    uiAssert(uiRect(Panels.timeline.container).right<=uiRect(document.querySelector('#center')).right,'Timeline exceeds the canvas column'); });
   await capture('animate');
   await run(() => { Modes.options.edit.select(); Settings.dialog.show(); });
   await delay(350);
   await run(() => {
    Settings.dialog.object.getAnimations().forEach(a=>a.finish());
    const dialog=uiRect(Settings.dialog.object), bar=uiRect(Settings.dialog.object.querySelector('.button_bar'));
    uiAssert(bar.bottom<=dialog.bottom-19,'Settings footer is outside its dialog');
    const toggle=Settings.dialog.object.querySelector('.toggle_switch');
    uiAssert(uiRect(toggle).width===52 && uiRect(toggle).height===48,'Switch target geometry is incorrect');
   });
   await capture('settings');
   await run(() => {
    Settings.dialog.hide();
    window.uiFixture = new Dialog({id:'material_ui_test',title:'Component inspection',width:640,
     form:{name:{type:'text',label:'Name',value:'Model'},count:{type:'number',label:'Count',value:12},
      mode:{type:'select',label:'Mode',options:{a:'First option',b:'Second option'},value:'a'},
      enabled:{type:'checkbox',label:'Enabled',value:true},description:{type:'textarea',label:'Description',value:'Supporting text'}},buttons:['Confirm','Cancel']});
    uiFixture.show();
   });
   win.setSize(640,480); await delay(350);
   await run(() => {
    uiFixture.object.getAnimations().forEach(a=>a.finish());
    const dialog=uiRect(uiFixture.object), content=uiFixture.object.querySelector('.dialog_content');
    const bar=uiRect(uiFixture.object.querySelector('.button_bar'));
    uiAssert(dialog.left>=24 && dialog.right<=innerWidth-24 && dialog.bottom<=innerHeight-24, 'Compact dialog lost its screen margins');
    uiAssert(bar.bottom<=dialog.bottom-19,'Compact form actions are not visible');
    uiAssert(content.scrollHeight>content.clientHeight,'Long form content does not scroll');
    uiAssert(uiRect(uiFixture.object.querySelector('input[type=text]')).height===56,'Text field height is incorrect');
    const confirm=uiRect(uiFixture.object.querySelector('.confirm_btn')), cancel=uiRect(uiFixture.object.querySelector('.cancel_btn'));
    uiAssert(confirm.left>cancel.left,'Confirm action is not the trailing action');
    uiAssert(uiFixture.getFormResult().count===12 && uiFixture.getFormResult().enabled===true,'Form values changed during resize');
   });
   await capture('compact-form');
   await run(() => { uiFixture.hide(); });
   await run(() => settings.interface_density.set('comfortable'));
   win.setSize(640,800); await delay(350);
   await run(() => {
    const overflow=document.querySelector('.tool_options .toolbar_overflow_button');
    uiAssert(overflow.offsetWidth>0,'Missing compact overflow affordance');
    overflow.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    const menu=document.querySelector('.contextMenu');
    uiAssert(menu && menu.innerText.includes(tl('action.transform_space')),'Clipped toolbar controls are missing from overflow');
    for (const item of menu.querySelectorAll('li:not(.menu_separator)')) {
     if (item.offsetWidth) uiAssert(uiRect(item).height>=48,'Menu row is too small');
    }
   });
   await capture('overflow');
   await run(() => { Menu.open?.hide(); });

   win.setSize(1280,900); await delay(250);
   await run(() => {
    settings.interface_density.set('compact');
    window.auditDialog = () => {
     const dialog=Dialog.open.object; dialog.getAnimations().forEach(a=>a.finish());
     const bounds=uiRect(dialog), content=dialog.querySelector('.dialog_content');
     const margin=parseFloat(getComputedStyle(dialog).getPropertyValue('--dialog-safe-margin'))||0;
     uiAssert(bounds.left>=margin-1 && bounds.right<=innerWidth-margin+1 && bounds.top>=margin-1 && bounds.bottom<=innerHeight-margin+1,'Dialog outside safe margins: '+Dialog.open.id+' '+JSON.stringify(bounds));
     uiAssert(content.clientWidth>=0 && content.scrollWidth<=content.clientWidth+2,'Horizontal overflow in '+Dialog.open.id+': '+content.scrollWidth+'/'+content.clientWidth);
     const footer=dialog.querySelector('.button_bar');
     if(footer) uiAssert(uiRect(footer).bottom<=bounds.bottom-16,'Footer clipped: '+Dialog.open.id);
     for(const row of content.querySelectorAll('.form_bar')) {
      if(!row.offsetWidth) continue;
      const box=uiRect(row);
      for(const field of row.querySelectorAll('input:not([type=range]), textarea, .bb-select, .numeric_input, .form_inline_select')) {
       if(!field.offsetWidth) continue;
       const f=uiRect(field);
       uiAssert(f.left>=box.left-1 && f.right<=box.right+1,'Field overflows row: '+Dialog.open.id+' '+row.className);
       if(field.matches('input:not([type=checkbox]):not([type=radio]), .bb-select')) uiAssert(f.height>=56,'Field compressed: '+row.className);
      }
      const label=row.querySelector(':scope > label');
      if(label && row.getAttribute('form_type')!=='checkbox') uiAssert(Math.abs(uiRect(label).left-box.left)<1,'Label keyline: '+row.className);
     }
     uiAssert(dialog.contains(document.activeElement),'Dialog lost keyboard focus: '+Dialog.open.id);
    };
   });
   const groups=[
    {name:{label:'Model name',value:'Long model name'},password:{label:'Password',type:'password',value:'example-only',description:'Use a unique password.'},notes:{label:'Notes',type:'textarea',value:'Multiline text\nSecond line',height:112},code:{label:'Expression',type:'textarea',style:'code',value:'return query.life_time;',height:112},readonly:{label:'Read-only identifier',value:'model:example',readonly:true,share_text:true}},
    {count:{label:'Count',type:'number',value:12,min:0,max:20,step:2,description:'Choose between 0 and 20.'},position:{label:'Position',type:'vector',value:[1,2,3],linked_ratio:true},amount:{label:'Amount',type:'range',value:50,min:0,max:100,editable_range_label:true},slider:{label:'Rotation',type:'num_slider',value:45,min:0,max:360},enabled:{label:'Enabled',type:'checkbox',style:'toggle_switch',value:true},optional:{label:'Optional field',value:'Disabled until selected',toggle_enabled:true,toggle_default:false}},
    {mode:{label:'Display mode',type:'select',options:{one:'First mode',two:'Second mode'},value:'two'},segment:{label:'Texture layout',type:'inline_select',options:{one:'Template',two:'Blank'},value:'one'},flags:{label:'Visible axes',type:'inline_multi_select',options:{x:'X',y:'Y',z:'Z'},value:{x:true,y:false,z:true}},chips:{label:'Channels',type:'multi_select',options:{a:'Color',b:'Normal',c:'Roughness'},value:['a','b']},choice:{label:'Export format',type:'radio',options:{a:'Standard',b:'Compressed'},value:'b'},choice2:{label:'Second group',type:'radio',options:{a:'Primary',b:'Secondary'},value:'a'},actions:{label:'Actions',type:'buttons',buttons:['Reset','Duplicate'],click:()=>{}}},
    {file:{label:'Texture file',type:'file',value:'/tmp/texture.png',extensions:['png']},folder:{label:'Output folder',type:'folder',value:'/tmp'},save:{label:'Save destination',type:'save',value:'/tmp/model.bbmodel'},color:{label:'Tint',type:'color',value:'#f0bd82'},node:{label:'Parent element',type:'outliner_node'},info:{type:'info',text:'Supporting information remains readable.'}}
   ];
   for(let i=0;i<groups.length;i++) {
    const form=JSON.stringify(groups[i]);
    await run(new Function(`const form=${form};if(form.node)form.node.getOutlinerNodes=()=>Outliner.elements;if(form.actions)form.actions.click=()=>{};window.componentDialog=new Dialog({id:'components_${i}',title:'Component gallery ${i+1}',width:640,form}).show();`));
    await delay(100);
    await run(()=>auditDialog());
    await capture('components-'+i);
    if(i===0) await run(()=>{
     const d=Dialog.open, password=d.object.querySelector('.password_toggle');
     password.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
     uiAssert(d.object.querySelector('#password').type==='text','Password keyboard toggle');
     const note=d.object.querySelector('textarea'); note.value='Edited\nTwo lines'; note.dispatchEvent(new Event('input',{bubbles:true}));
     uiAssert(d.getFormResult().notes==='Edited\nTwo lines','Multiline value lost');
     const first=d.object.querySelector('.focusable_input'), last=d.object.querySelector('.dialog_close_button');
     last.focus(); last.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
     uiAssert(document.activeElement===first,'Dialog focus does not wrap');
    });
    if(i===1) await run(()=>{
     const field=Dialog.open.object.querySelector('#count'); field.focus();
     field.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));
     uiAssert(Dialog.open.getFormResult().count===14,'Numeric keyboard step');
     uiAssert(Dialog.open.object.querySelector('#optional').inert,'Disabled field remains focusable');
     Dialog.open.setFormToggles({optional:true});
     uiAssert(!Dialog.open.object.querySelector('#optional').inert,'Programmatic enable leaves field inert');
    });
    if(i===2) await run(()=>{
     const d=Dialog.open;
     uiAssert(d.getFormResult().choice==='b' && d.getFormResult().choice2==='a','Radio defaults or groups collide');
     const select=d.object.querySelector('.bb-select');
     select.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
     uiAssert(!!Menu.open,'Custom select keyboard opening'); Menu.open.hide();
     const option=d.object.querySelectorAll('.form_inline_select li')[1];
     option.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));
     uiAssert(d.getFormResult().segment==='two' && option.getAttribute('aria-pressed')==='true','Segment keyboard selection');
    });
    if(i===3) {
     await run(()=>{Dialog.open.form.form_data.color.colorpicker.jq.spectrum('show');});
     await delay(100);await capture('color-picker');
     await run(()=>{const popup=[...document.querySelectorAll('.sp-container:not(.sp-flat)')].find(n=>n.offsetWidth);const r=uiRect(popup);uiAssert(r.right<=innerWidth && r.bottom<=innerHeight,'Color picker exceeds window');Dialog.open.form.form_data.color.colorpicker.hide();});
    }
    win.setSize(640,480); await delay(200);
    await run(()=>auditDialog());
    await capture('components-'+i+'-small');
    await run(()=>{Dialog.open.hide();componentDialog.delete();});
    win.setSize(1280,900); await delay(200);
   }
   await run(()=>{
    window.messageFixture=Blockbench.showMessageBox({title:'Replace texture?',message:'The existing texture will be replaced. This action can be undone.',buttons:['Replace','Cancel'],checkboxes:{remember:{text:'Remember this choice',value:true}}});
   });
   await delay(150); await run(()=>{auditDialog();uiAssert(Dialog.open.object.querySelector('input[type=checkbox]').checked,'Message checkbox default');});
   await capture('message-box'); await run(()=>Dialog.open.cancel());
   await run(()=>{Blockbench.showMessageBox({title:'Choose an export',commands:{model:{text:'Model',description:'Export editable model data',icon:'view_in_ar'},texture:{text:'Texture',description:'Export the painted texture',icon:'image'}},buttons:['Cancel']});});
   await delay(100); await run(()=>auditDialog()); await capture('command-dialog'); await run(()=>Dialog.open.cancel());
   await run(()=>{
    window.configFixture=new ConfigDialog('config_test',{title:'Tool configuration',form:{strength:{label:'Strength',type:'number',value:1},falloff:{label:'Falloff',type:'select',options:{linear:'Linear',smooth:'Smooth'}},enabled:{label:'Preview',type:'checkbox',value:true}}});
    configFixture.show(document.querySelector('#mode_selector'));
   });
   await delay(100); await run(()=>auditDialog()); await capture('config-dialog'); await run(()=>{configFixture.hide();configFixture.delete();});
   const actions=['project_window','add_mesh','create_texture','create_humanoid','procedural_tree','scale','advanced_screenshot','record_model_gif','timelapse','keybindings_window','settings_window','theme_window'];
   for(const id of actions) {
    await run(new Function(`uiAssert(!!BarItems['${id}'],'Missing gallery action ${id}');BarItems['${id}'].trigger();`));
    await delay(300); await run(()=>auditDialog()); await capture('dialog-'+id);
    win.setSize(800,640); await delay(200); await run(()=>auditDialog()); await capture('dialog-'+id+'-small');
    await run(()=>Dialog.open.cancel()); win.setSize(1280,900); await delay(200);
   }

   await run(()=>{Settings.dialog.show();Settings.dialog.sidebar.setPage('interface');});
   await delay(200);await run(()=>auditDialog());await capture('density-settings');
   await run(()=>{Settings.dialog.hide();window.animationFixture=new Animation({name:'Walk cycle'}).add(false);animationFixture.propertiesDialog();});
   await delay(200);await run(()=>auditDialog());await capture('animation-properties');
   await run(()=>{
    Dialog.open.content_vue.openMolangContextMenu(new MouseEvent('contextmenu',{clientX:400,clientY:300}),'anim_time_update','query.life_time;');
    Menu.open.node.querySelector('li').click();
   });
   await delay(200);await run(()=>auditDialog());await capture('expression-editor');
   win.setSize(640,480);await delay(200);await run(()=>auditDialog());await capture('expression-editor-small');
   win.setSize(1280,900);await delay(200);
   await run(()=>{Dialog.open.content_vue.findReplace();});await delay(200);await run(()=>auditDialog());await capture('find-replace');
   await run(()=>{Dialog.open.cancel();Dialog.open.cancel();Dialog.open.cancel();});
   await run(()=>Blockbench.showMessageBox({title:'Save changes?',message:'Choose what happens to the edited model.',buttons:['Save','Discard','Cancel']}) && undefined);
   await delay(100);await run(()=>{auditDialog();uiAssert(Dialog.open.object.querySelectorAll('.button_bar button').length===1 && Dialog.open.object.querySelectorAll('.dialog_choices button').length===2,'Multiple outcomes not presented as choices');});await capture('choice-dialog');await run(()=>Dialog.open.cancel());
   await run(()=>{window.validationFixture=new Dialog({id:'validation_test',title:'Name the model',form:{name:{label:'Name',required:true,pattern:'[A-Za-z]+',description:'Use letters only.'}},onConfirm(){window.validationConfirmed=true;}}).show();validationFixture.confirm();uiAssert(Dialog.open===validationFixture && validationFixture.object.querySelector('[aria-invalid=true]'),'Invalid form was accepted');});
   await capture('validation-error');
   await run(()=>{const input=validationFixture.object.querySelector('input');input.value='Model';input.dispatchEvent(new Event('input',{bubbles:true}));uiAssert(input.getAttribute('aria-invalid')==='false','Error state was not cleared');validationFixture.confirm();uiAssert(window.validationConfirmed,'Valid form was not accepted');validationFixture.delete();});
   await run(()=>{
    window.longMenu=new Menu('long_menu',Array.from({length:30},(_,i)=>({name:'Option '+i,children:i===0?[{name:'Nested action',click(){}}]:undefined,click(){}}))).open({clientX:innerWidth-20,clientY:innerHeight-20});
    uiAssert(longMenu.node.scrollHeight>longMenu.node.clientHeight,'Long menu does not scroll');
    const r=uiRect(longMenu.node);uiAssert(r.top>=0 && r.bottom<=innerHeight,'Long menu extends off screen');
    longMenu.keyNavigate(new KeyboardEvent('keydown',{key:'End',keyCode:35}));
    uiAssert(longMenu.node.scrollTop>0 && longMenu.node.getAttribute('aria-activedescendant')===longMenu.node.lastElementChild.id,'Menu keyboard scrolling');
    longMenu.keyNavigate(new KeyboardEvent('keydown',{key:'Home',keyCode:36}));
    longMenu.hover(longMenu.node.querySelector('li'),undefined,true);
    const sub=longMenu.node.querySelector('ul');uiAssert(uiRect(sub).left>=0 && uiRect(sub).right<=innerWidth,'Submenu placement');
   });await capture('scrolling-menu');await run(()=>longMenu.hide() && undefined);
   await run(()=>{
    window.fullscreenFixture=new Dialog({id:'fullscreen_test',title:'Create model',form:{name:{label:'Name',value:'Model'},notes:{label:'Notes',type:'textarea',value:'Text'}}}).show();
   });
   win.setSize(560,600);await delay(200);await run(()=>{auditDialog();uiAssert(uiRect(Dialog.open.object).width===innerWidth,'Compact form does not become full-screen');});await capture('fullscreen-form');
   await run(()=>{Dialog.open.hide();fullscreenFixture.delete();});win.setSize(1280,900);await delay(200);
   win.webContents.debugger.attach('1.3');
   await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
   await run(() => {
    UVEditor.panel.fold(true);
    uiAssert(!UVEditor.panel.container.getAnimations().length,'Reduced motion still animates folding');
    uiAssert(getComputedStyle(document.querySelector('.toolbar_menu')).transitionDuration==='0s','Reduced motion still transitions controls');
    UVEditor.panel.fold(false);
   });
   console.log('PASS: Material UI dimensions, alignment, responsive panes, keyboard controls, modes, settings, forms, overflow, and reduced motion.');
   console.log('Screenshots:', output);
   app.exit(0);
  } catch(error) { await capture('failure'); console.error(error); app.exit(1); }
 });
});
setTimeout(()=>{console.error('Material UI checks timed out');app.exit(1);},180000);
import(pathToFileURL(resolve(__dirname,'../electron/main.js')).href);
