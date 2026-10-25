import { ipcRenderer, currentwindow } from '../native_apis';
import { MenuBar } from './menu_bar';
import { Menu, MenuSeparator } from './menu';

let timer: ReturnType<typeof setTimeout>;
let initialized = false;
let previous = '';
let commands = new Map<string, () => void>();

function accelerator(keybind: Keybind): string | undefined {
	if (!keybind || keybind.key < 0) return;
	const key = keybind.key >= 65 && keybind.key <= 90 ? String.fromCharCode(keybind.key)
		: ({8: 'Backspace', 9: 'Tab', 13: 'Enter', 27: 'Escape', 32: 'Space', 46: 'Delete'} as Record<number, string>)[keybind.key];
	if (!key) return;
	return [keybind.meta && 'Command', keybind.ctrl && 'Control', keybind.alt && 'Alt', keybind.shift && 'Shift', key].filter(Boolean).join('+');
}

export function updateNativeMenu() {
	if (!isApp || Blockbench.platform !== 'darwin') return;
	if (!initialized) {
		initialized = true;
		ipcRenderer.on('native-menu-command', (_, id: string) => {
			const textCommands = {undo: 'undo', redo: 'redo', cut: 'cut', copy: 'copy', paste: 'paste', select_all: 'selectAll'};
			const actionId = id.startsWith('app:') ? id.slice(4) : id.split('/').pop();
			const active = document.activeElement as HTMLElement;
			if (active?.matches('input, textarea, [contenteditable]') && textCommands[actionId]) {
				// Electron's editing APIs also handle password fields and clipboard permissions.
				currentwindow.webContents[textCommands[actionId]]();
			} else if (id.startsWith('app:')) {
				(BarItems[actionId] as Action)?.trigger();
			} else {
				commands.get(id)?.();
			}
			updateNativeMenu();
		});
		window.addEventListener('focus', updateNativeMenu);
		document.addEventListener('focusin', updateNativeMenu);
		document.addEventListener('focusout', updateNativeMenu);
		// Selection, undo state, plugin menus and modes can change without rebuilding the ribbon.
		setInterval(updateNativeMenu, 500);
	}
	clearTimeout(timer);
	timer = setTimeout(() => {
		const next = new Map<string, () => void>();
		const event = new MouseEvent('click');
		Object.defineProperty(event, 'target', {value: document.body});
		function convert(structure: any, parent: string, context?: any, depth = 0): any[] {
			if (depth > 12) return [];
			let list = typeof structure === 'function' ? structure(context) : structure;
			if (parent === 'edit') list = [...list, '_', 'cut', 'copy', 'paste'];
			const entries: any[] = [];
			for (let [index, item] of (list || []).entries()) {
				if (typeof item === 'function') item = item(context);
				if (item === '_' || typeof item === 'string' && item.startsWith('#') || item instanceof MenuSeparator) {
					if (entries.length && entries.at(-1).type !== 'separator') entries.push({type: 'separator'});
					continue;
				}
				if (typeof item === 'string') item = BarItems[item];
				if (!item) continue;
				const scopeContext = item.context ?? context;
				if (!Condition(item.condition, scopeContext)) continue;
				const id = `${parent}/${item.id || index}`;
				const entry: any = {id, label: tl(item.name || item.id), enabled: !open_interface || !!item.work_in_dialog};
				const invoke = () => {
					if (!Condition(item.condition, scopeContext) || (open_interface && !item.work_in_dialog)) return;
					if (item instanceof Action) item.trigger(event);
					else item.click?.(scopeContext, event);
				};
				next.set(id, invoke);
				if (item.children) entry.submenu = convert(item.children, id, scopeContext, depth + 1);
				else if (item instanceof BarSelect) {
					entry.submenu = Object.entries(item.options).filter(([, option]: any) => option && Condition(option.condition)).map(([key]) => {
						const optionId = `${id}/${key}`;
						next.set(optionId, () => { item.set(key); item.onChange?.(item, event); });
						return {id: optionId, label: item.getNameFor(key), type: 'radio', checked: item.value === key};
					});
				} else if (item instanceof NumSlider) {
					next.set(id, () => new Dialog({id: 'native_menu_value', title: item.name,
						form: {value: {type: 'number', value: item.get(), ...item.settings}},
						onConfirm(result) { item.onBefore?.(); item.change(() => result.value); item.update(); item.onAfter?.(); }
					}).show());
				}
				if (item.side_menu instanceof Menu) {
					entry.submenu = convert(item.side_menu.structure, id + '/options', scopeContext, depth + 1);
				} else if (item.side_menu instanceof Dialog) {
					const optionsId = id + '/options';
					next.set(optionsId, () => item.side_menu.show());
					entry.submenu = [{id: optionsId, label: tl('menu.options')}];
				}
				if (entry.submenu && (item instanceof Tool || item.side_menu || (!(item instanceof Action) && item.click))) {
					entry.submenu.unshift({id, label: entry.label}, {type: 'separator'});
				}
				if (entry.submenu && !entry.submenu.length) continue;
				if (!entry.submenu) entry.accelerator = accelerator(item.keybind);
				if (item instanceof Toggle) { entry.type = 'checkbox'; entry.checked = item.value; }
				else if (item.marked) { entry.type = 'checkbox'; entry.checked = Condition(item.marked, scopeContext); }
				entries.push(entry);
			}
			if (entries.at(-1)?.type === 'separator') entries.pop();
			return entries;
		}
		try {
			const editingText = (document.activeElement as HTMLElement)?.matches('input, textarea, [contenteditable]');
			const snapshot = Object.values(MenuBar.menus).filter(menu => Condition(menu.condition)).map(menu => ({
				id: menu.id, label: menu.name, submenu: menu.id === 'edit' && editingText
					? ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].map(role => ({role}))
					: convert(menu.structure, menu.id)
			})).filter(menu => menu.submenu.length);
			commands = next;
			document.body.classList.add('native_macos_menu');
			const serialized = JSON.stringify(snapshot);
			if (serialized !== previous) { previous = serialized; ipcRenderer.send('native-menu-update', snapshot); }
		} catch (error) { document.body.classList.remove('native_macos_menu'); previous = ''; console.error('Unable to update native menu', error.stack || error); }
	}, 50);
}
