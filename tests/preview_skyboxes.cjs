// Exercise actual WebGL uploads, scene switching, and orthographic backgrounds.
const {app} = require('electron');
const {mkdtempSync, rmSync, mkdirSync, writeFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join, resolve} = require('node:path');
const {pathToFileURL} = require('node:url');
const profile = mkdtempSync(join(tmpdir(), '3dbench-skyboxes-'));
const output = resolve('.scratch/preview-skyboxes');
mkdirSync(output, {recursive: true});
process.argv.push('--userData', profile);
app.requestSingleInstanceLock = () => true;
app.on('quit', () => rmSync(profile, {recursive: true, force: true}));
let started = false;
app.on('browser-window-created', (_, win) => {
	win.webContents.on('did-finish-load', async () => {
		if (started) return;
		started = true;
		try {
			win.setSize(1280, 900);
			const result = await win.webContents.executeJavaScript(`(async () => {
				const assert = (value, message) => {if (!value) throw new Error(message);};
				newProject(Formats.free);
				new Cube({name: 'Skybox test', from: [-8, 0, -8], to: [8, 16, 8]}).init().select();
				await Vue.nextTick();
				await new Promise(resolve => setTimeout(resolve, 400));
				assert(!PreviewScene.scenes.studio && !PreviewModel.models.studio, 'Studio is still registered');
				const ids = ['neutral', 'clear_sky', 'overcast', 'sunset', 'night'];
				const menu = BarItems.preview_scene.children();
				assert(ids.every(id => menu.some(entry => entry.id === id)), 'Skyboxes missing from scene menu');
				assert(!menu.some(entry => entry.id === 'studio'), 'Studio still in menu');
				const samples = [];
				for (const id of ids) {
					const scene = PreviewScene.scenes[id];
					assert(!scene.cubemap, 'Skybox generated before first selection');
					await scene.select();
					assert(Canvas.scene.background === scene.cubemap, 'Scene did not apply background');
					assert(scene.cubemap.images.length === 6, 'Incomplete cubemap');
					const face = scene.cubemap.images[0];
					samples.push([...face.getContext('2d').getImageData(128, 80, 1, 1).data].join(','));
					for (const ortho of [false, true]) {
						Preview.selected.setProjectionMode(ortho);
						Preview.selected.render();
						assert(Canvas.scene.background === scene.cubemap, 'Orthographic render lost background');
						assert(Preview.selected.renderer.getContext().getError() === 0, 'WebGL error rendering '+id);
					}
					const texture = scene.cubemap;
					await scene.select();
					assert(scene.cubemap === texture, 'Reselection regenerated texture');
				}
				assert(new Set(samples).size === ids.length, 'Presets have identical backgrounds');
				PreviewScene.active.unselect();
				assert(Canvas.scene.background === null && Canvas.scene.fog === null, 'None did not restore background');
				assert(Canvas.global_light_color.getHex() === 0xffffff, 'None did not restore lighting');
				Preview.selected.setProjectionMode(false);
				await PreviewScene.scenes.clear_sky.select();
				Preview.selected.render();
				return 'PASS: Five lazy, distinct skyboxes; Studio removed; menu, WebGL, perspective, orthographic, reuse, and None.';
			})()`);
			await new Promise(resolve => setTimeout(resolve, 350));
			writeFileSync(join(output, 'clear-sky.png'), (await win.webContents.capturePage()).toPNG());
			console.log(result);
			app.exit(0);
		} catch (error) {
			console.error(error);
			app.exit(1);
		}
	});
});
setTimeout(() => {console.error('Skybox checks timed out'); app.exit(1);}, 60000);
import(pathToFileURL(resolve(__dirname, '../electron/main.js')).href);
