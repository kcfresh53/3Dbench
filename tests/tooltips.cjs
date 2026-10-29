// Real-renderer regression checks for clipping, modal stacking, clones and theme changes.
const {app} = require('electron');
const {mkdtempSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join, resolve} = require('node:path');
const {pathToFileURL} = require('node:url');
const profile = mkdtempSync(join(tmpdir(), '3dbench-tooltips-'));
process.argv.push('--userData', profile);
app.requestSingleInstanceLock = () => true;
app.on('quit', () => rmSync(profile, {recursive: true, force: true}));
let started = false;
app.on('browser-window-created', (_, win) => {
 win.webContents.on('did-finish-load', async () => {
  if (started) return;
  started = true;
  try {
   await win.webContents.executeJavaScript(`(${async function() {
    const assert = (value, message) => { if (!value) throw new Error(message); };
    const tick = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const enter = node => node.dispatchEvent(new PointerEvent('pointerover', {bubbles:true, pointerType:'mouse'}));
    const leave = node => node.dispatchEvent(new PointerEvent('pointerout', {bubbles:true, pointerType:'mouse', relatedTarget:document.body}));
    const action = new Action('tooltip_regression', {name:'Tooltip title', description:'action.position_slider_per_element.desc', icon:'help', click() {}});
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:20px;top:100px;width:40px;height:36px;overflow:hidden;transform:translateZ(0);z-index:1';
    const node = action.getNode();
    host.append(node); document.body.append(host);
    const cover = document.createElement('div');
    cover.style.cssText = 'position:fixed;inset:0;z-index:999999;background:red;pointer-events:none';
    document.body.append(cover);
    enter(node); await tick();
    const tooltip = node.querySelector('.tooltip');
    assert(tooltip.matches(':popover-open'), 'Tooltip did not enter the top layer');
    assert(tooltip.getBoundingClientRect().bottom > host.getBoundingClientRect().bottom, 'Fixture does not exercise clipping');
    assert(tooltip.parentNode === node, 'Tooltip lost its owner');
    for (const mode of ['light', 'dark']) {
     AppTheme.update({mode, accent_source:'custom', accent_custom:'#0055dd', surface:'tinted'});
     await tick();
     const probe = document.createElement('div');
     probe.style.cssText = 'background:var(--md-sys-color-inverse-surface);color:var(--md-sys-color-inverse-on-surface)';
     document.body.append(probe);
     const expected = getComputedStyle(probe);
     for (const part of [tooltip, tooltip.querySelector('.tooltip_description')]) {
      const style = getComputedStyle(part);
      assert(style.backgroundColor === expected.backgroundColor && style.color === expected.color, 'Tooltip colors disagree with '+mode+' theme');
     }
     probe.remove();
    }
    leave(node); assert(!tooltip.matches(':popover-open'), 'Tooltip stayed open after leaving');
    enter(node); await tick(); assert(tooltip.matches(':popover-open'), 'Tooltip cannot reopen');
    document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    assert(!tooltip.matches(':popover-open'), 'Escape did not dismiss tooltip');
    cover.remove();
    const clone = action.getNode(); host.replaceChildren(clone);
    enter(clone); await tick();
    assert(clone.querySelector('.tooltip').matches(':popover-open'), 'Cloned toolbar label did not open');
    leave(clone);
    const dialog = document.createElement('dialog'); document.body.append(dialog); dialog.append(host); dialog.style.display = 'block'; dialog.showModal();
    host.style.cssText = 'position:fixed;right:8px;bottom:8px;width:40px;height:36px;overflow:hidden';
    await tick();
    enter(clone); await tick();
    const popup = clone.querySelector('.tooltip');
    assert(popup.matches(':popover-open'), 'Modal tooltip did not open');
    const rect = popup.getBoundingClientRect(), description = popup.querySelector('.tooltip_description').getBoundingClientRect();
    assert(rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && description.bottom <= innerHeight, 'Tooltip escapes viewport');
    dialog.remove(); await tick();
    assert(!popup.matches(':popover-open'), 'Detached tooltip remained open');
    action.delete();
   }.toString()})()`);
   console.log('PASS: Tooltip top layer, clipping, modal placement, cloned controls, reopening, dismissal, light and dark themes.');
   app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
 });
});
setTimeout(() => { console.error('Tooltip checks timed out'); app.exit(1); }, 60000);
import(pathToFileURL(resolve(__dirname, '../electron/main.js')).href);
