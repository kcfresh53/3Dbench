# Material 3 UI contract

The UI follows Material 3 (m3.material.io) with a dynamic color system. A seed color is turned into the full 49-role `--md-sys-color-*` scheme with `@material/material-color-utilities` (HCT, 2025 spec). Component rules in `css/material.css` consume those tokens plus the M3 shape, type, elevation, state-layer and motion tokens, so nothing hard-codes a color. Typeface remains Outfit.

## Appearance settings

*Settings → Appearance* (action `theme_window`) controls everything the old theme system did:

| Setting | Options |
| --- | --- |
| Mode | System, dark, light |
| Accent source | Preset swatches, custom color, or the operating-system accent |
| Palette style | Tonal spot, vibrant, expressive, neutral |
| Surfaces | Graphite (near-neutral greys) or tinted by the accent |
| Contrast | Standard, medium, high (M3 contrast levels 0 / 0.5 / 1) |
| Glass | Liquid-glass finish on or off; off is strict flat Material 3 |

The OS accent comes from Electron `systemPreferences.getAccentColor()` on macOS and Windows, the GNOME `accent-color` gsetting, or KDE `kdeglobals`. It is unavailable on the web build and on desktops that publish no accent; the option is disabled there. A macOS "multicolor" accent reads as the default blue.

Source layout (`js/interface/theme/`): `color_scheme.ts` (pure scheme generation), `accent_presets.ts`, `system_accent.ts`, `theme_css.ts` (stylesheet builder), `appearance_settings.ts` (validated stored model), `app_theme.ts` (applies and persists), `appearance_dialog.ts` (UI). The generated sheet is cached in `localStorage.appearance_boot` and applied before first paint by `index.html`. Legacy `--color-*` variables are generated aliases of the roles so existing CSS, plugins and three.js keep working; the deprecated `window.CustomTheme` object is a read-only compatibility shim. `.bbtheme` files are no longer loaded.

## Component constraints

| Component | Constraint |
| --- | --- |
| Icon actions | 48 × 48 interaction target, centered 24px icon, 40px state layer |
| Text buttons | 40px visual height, 14/20 medium label, extended 48px hit area, 8px action spacing |
| Text and numeric form fields | 56px height, 16/24 text, 16px inset, visible focus and error states |
| Numeric editing controls | 48px interaction row, 40px field, responsive wrapping |
| Checkboxes and radios | 48px target around the selection indicator |
| Switches | 52 × 32 track inside a 52 × 48 target; 16px inactive and 24px active thumb |
| Menus | 48px action rows, 8px vertical container padding, 16px horizontal keylines, independent dividers |
| Dialogs | 28px corners, 24px headline/content/action keylines, scrollable content and visible action row |
| Tabs | 48px interaction row with a selected indicator; mode switching uses tonal segments |
| Lists | 48px outliner rows; 56–64px animation/texture rows accommodate supporting content |
| Shape and spacing | 4/8/16/28px shape roles, full rounding for icon controls; spacing in 4px increments |
| Typography | Body medium 14/20, body large 16/24, label large 14/20 medium, headline small 24/32 |
| Motion | Shared 150ms effects and 300ms movement with standard non-overshooting easing; reduced motion disables transitions and folding animation |

Desktop windows below the 1200px large-window breakpoint show one supporting pane at a time. The status-bar controls switch panes. Expanding the window restores both panes without rewriting saved pane widths. The fitting calculation reserves at least 320px for the canvas; timelines measure the resulting canvas column rather than subtracting nominal sidebar widths.

Dialogs retain 24px screen margins (16px on small screens). Their footer stays outside the scrolling content. Confirmation follows dismissal visually. Overflow menus include controls clipped horizontally as well as controls wrapped below the visible toolbar row.

## Verification

Run `npm run test:theme` for the color engine (contrast of every text pair across presets, variants, modes, surfaces and contrast levels; stylesheet and settings validation). Run `npm run test:ui`. It builds Electron and launches a temporary profile, leaving the normal user profile untouched. Screenshots are written to `.scratch/material-ui/`.

The suite checks the real renderer at 1512px, 1080px, 800px and 640px widths, including a 640 × 480 window. It covers icon geometry, UV header collisions, canvas and timeline containment, supporting-pane switching and restoration, keyboard activation, Paint and Animate, settings, form values after resize, compact-dialog scrolling and footer placement, toolbar overflow, and reduced motion.

The native window controls and the editor's 3D canvas, UV map, and timeline are specialized application surfaces. Their surrounding controls follow the shared contract. Third-party plugin markup requires separate verification; this suite does not certify them.

## References

- [Material 3 layout and density](https://m3.material.io/foundations/layout/grids-spacing/density)
- [Material 3 motion](https://m3.material.io/styles/motion/overview/how-it-works)
- [Google Material Web component tokens](https://github.com/material-components/material-web/tree/main/tokens/versions/v0_192)
