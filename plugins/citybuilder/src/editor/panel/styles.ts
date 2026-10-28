import { PANEL_CSS } from '../../../../roadscape/src/editor/panel/styles';

const BASE: string = PANEL_CSS.split('#panel_roadscape_panel').join('#panel_citybuilder_panel');

/** Roadscape's field styles, re-scoped to this panel, plus the pieces only this panel has. */
export const CITY_PANEL_CSS: string =
	BASE +
	`
#panel_citybuilder_panel .rs_panel{padding:8px;display:flex;flex-direction:column;gap:8px;overflow-y:auto;min-height:0}
#panel_citybuilder_panel .cb_modes{display:grid;grid-template-columns:repeat(auto-fill,minmax(70px,1fr));gap:4px}
#panel_citybuilder_panel .cb_modes button.cb_on,#panel_citybuilder_panel .cb_zone.cb_on{outline:2px solid var(--color-accent);outline-offset:-2px}
#panel_citybuilder_panel .cb_zones{display:grid;grid-template-columns:repeat(2,1fr);gap:4px}
#panel_citybuilder_panel .cb_zone{display:flex;align-items:center;gap:6px;padding:3px 6px;text-align:left;overflow:hidden}
#panel_citybuilder_panel .cb_zone i{width:12px;height:12px;border-radius:3px;flex:none;border:1px solid rgba(0,0,0,.35)}
#panel_citybuilder_panel .cb_zone span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.85em}
#panel_citybuilder_panel .cb_swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:4px}
#panel_citybuilder_panel .cb_stats{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;text-align:center}
#panel_citybuilder_panel .cb_stats div{background:var(--color-back);border:1px solid var(--color-border);border-radius:4px;padding:3px 2px}
#panel_citybuilder_panel .cb_stats b{display:block;font-size:1.05em}
#panel_citybuilder_panel .cb_stats small{color:var(--color-subtle_text)}
#panel_citybuilder_panel .cb_busy{color:var(--color-accent);margin:0}
`;
