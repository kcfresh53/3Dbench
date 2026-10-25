import { app, BrowserWindow, Menu, ipcMain } from 'electron';

// Each window owns its command snapshot. Native clicks always return to that window.
export function initializeApplicationMenu() {
	if (process.platform !== 'darwin') return;
	const snapshots = new Map();
	function install(win) {
		if (!win || win.isDestroyed()) return;
		const snapshot = snapshots.get(win.webContents.id);
		if (!snapshot) return;
		const command = id => () => {
			if (!win.isDestroyed()) win.webContents.send('native-menu-command', id);
		};
		function convert(items) {
			return items.map(item => item.type === 'separator' ? {type: 'separator'} : item.role ? {role: item.role} : {
				...item,
				...(item.submenu ? {submenu: convert(item.submenu)} : {click: command(item.id)})
			});
		}
		Menu.setApplicationMenu(Menu.buildFromTemplate([
			{label: app.name, submenu: [
				{label: 'About 3D Bench', click: command('app:about_window')},
				{type: 'separator'},
				{label: 'Settings…', accelerator: 'Command+,', click: command('app:settings_window')},
				{type: 'separator'}, {role: 'services'}, {type: 'separator'},
				{role: 'hide'}, {role: 'hideOthers'}, {role: 'unhide'},
				{type: 'separator'}, {role: 'quit'}
			]},
			...convert(snapshot),
			{role: 'windowMenu', submenu: [{role: 'minimize'}, {role: 'zoom'}, {role: 'togglefullscreen'}, {type: 'separator'}, {role: 'front'}]}
		]));
	}
	ipcMain.on('native-menu-update', (event, snapshot) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win || !Array.isArray(snapshot)) return;
		snapshots.set(event.sender.id, snapshot);
		if (win.isFocused()) install(win);
	});
	app.on('browser-window-focus', (_, win) => install(win));
	app.on('web-contents-created', (_, contents) => {
		contents.once('destroyed', () => snapshots.delete(contents.id));
	});
}
