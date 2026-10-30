/** Material resources live alongside the plugin, keeping 4K image data out of executable JS. */
export function materialResource(filename: string): string {
 const registry = globalThis as unknown as { Plugins?: { all?: Array<{id:string;path:string}>; registered?: Record<string,{path:string}> }; location?: {href:string} };
 const plugin = registry.Plugins?.all?.find(p => p.id === 'citybuilder') ?? registry.Plugins?.registered?.citybuilder ?? registry.Plugins?.all?.find(p=>p.id==='roadscape') ?? registry.Plugins?.registered?.roadscape;
 const path = plugin?.path;
 if (path) return path.replace(/[^/\\]+$/, '') + 'citybuilder/textures/pbr/' + filename;
 // Source/test harnesses and development builds run from the repository root.
 return 'plugins/citybuilder/textures/pbr/' + filename;
}
