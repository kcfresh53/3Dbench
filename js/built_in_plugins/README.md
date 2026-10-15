# Built-in features

These plugins ship in the application bundle and initialize automatically after
the editor UI and compatibility API are ready:

| Feature | Version | Author | Location |
| --- | --- | --- | --- |
| Easing Peasy | 1.0.1 | Titus Evans (SnaveSutit) | Easing panel in Animation mode |
| Optimize | 1.2.8 | Krozi | Tools → Optimize |
| glTF Importer | 1.2.1 | 0x13F | File → Import → Import glTF Model (desktop, mesh formats) |

Easing Peasy and Optimize came from the supplied JavaScript files. The glTF
importer came from
https://github.com/JannisX11/blockbench-plugins/tree/master/plugins/gltf_importer.
Its existing desktop restriction and optional camera/repeating-texture plugin
integrations are preserved.

Each source is wrapped in an initializer so importing the module does not execute
plugin code before the editor is ready. Optimize additionally declares its legacy
variables and works on snapshots of cubes, preserving other element types and
supporting undo. Bundled feature IDs supersede saved plugin installations and
store listings, preventing duplicate registrations. Built-in entries cannot be
disabled, uninstalled, or updated through the plugin manager.

Attribution and supplied license notices are in `assets/built_in_plugins`, which
is included in desktop packages. Easing Peasy also retains its original MIT header.

Run `npm run test:builtins` to build and exercise the features in an isolated
Electron profile. The test checks registration, easing interpolation and saved
properties, optimization with mixed element types and undo, glTF mesh import,
and protection against disabling or replacing built-in features.
