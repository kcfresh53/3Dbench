import { Plugin, Plugins } from '../plugin_loader';
import { Blockbench } from '../api';
import initializeEasing from './easing_peasy';
import initializeOptimize from './optimize';
import initializeGltf from './gltf_importer';

/** Run bundled features after the editor UI and legacy API aliases are ready. */
export function loadBuiltInPlugins() {
	const api = {
		register(id, data) {
			const plugin = Plugins.registered[id];
			plugin.extend(data);
			plugin.source = 'builtin';
			plugin.installed = true;
			plugin.icon = id === 'gltf_importer' ? 'icon-gltf' : id === 'easing_peasy' ? 'timeline' : data.icon;
			plugin.about = `${data.description}\n\nBuilt into 3D Bench.\n\nAuthor: ${data.author}\n\nVersion: ${data.version}`;
			plugin.has_changelog = false;
			Plugins.registered[id] = plugin;
			if (plugin.isInstallable() === true) plugin.runOnLoad();
			return plugin;
		}
	};
	for (const [id, initialize] of [
		['easing_peasy', initializeEasing],
		['optimize', initializeOptimize],
		...(isApp ? [['gltf_importer', initializeGltf]] : []),
	] as [string, (pluginApi: typeof api) => void][]) {
		if (Plugins.registered[id]?.source === 'builtin') continue;
		// Some plugins register patches before their final registration call.
		const plugin = new Plugin(id);
		plugin.source = 'builtin';
		plugin.installed = true;
		Plugins.registered[id] = plugin;
		try {
			Plugins.currently_loading = id;
			initialize(api);
		} catch (error) {
			plugin.installed = false;
			console.error(`Failed to initialize built-in feature ${id}`, error);
			Blockbench.showQuickMessage(`Could not initialize ${id}. See the console for details.`);
		} finally {
			Plugins.currently_loading = '';
		}
	}
}
