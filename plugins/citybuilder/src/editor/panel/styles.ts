import { PANEL_CSS } from '../../../../roadscape/src/editor/panel/styles';

const BASE: string = PANEL_CSS.split('#panel_roadscape_panel').join('#panel_citybuilder_panel');

/** Roadscape's field styles, re-scoped to this panel, plus the pieces only this panel has. */
export const CITY_PANEL_CSS: string =
	BASE +
	`
#panel_citybuilder_panel .rs_panel{padding:8px;display:flex;flex-direction:column;gap:8px;overflow-y:auto;min-height:0}
#panel_citybuilder_panel button{height:auto;min-height:28px;min-width:0;white-space:normal;line-height:1.25;padding:5px 8px;text-align:center;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box}
#panel_citybuilder_panel .cb_tabs button:not(.cb_on){background:var(--color-back);color:var(--color-text);border:1px solid var(--color-border)}
#panel_citybuilder_panel button::before{inset:0}
#panel_citybuilder_panel .rs_status{max-height:2.5em;overflow:hidden;line-height:1.25}
#panel_citybuilder_panel .cb_tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;position:sticky;top:0;z-index:1;background:var(--color-back);padding:4px 0}
#panel_citybuilder_panel button.cb_on{background:var(--color-accent);color:var(--color-accent_text)}
#panel_citybuilder_panel .rs_field{grid-template-columns:minmax(0,1fr) minmax(70px,100px)}
#panel_citybuilder_panel .rs_field>span{overflow-wrap:anywhere}
#panel_citybuilder_panel .rs_row button{flex:1 1 110px}
#panel_citybuilder_panel .cb_zone{justify-content:flex-start}
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
