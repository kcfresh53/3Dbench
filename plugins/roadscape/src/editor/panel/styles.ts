export const PANEL_CSS: string = `
#panel_roadscape_panel .rs_panel{padding:8px;display:flex;flex-direction:column;gap:8px;overflow-y:auto;min-height:0}
#panel_roadscape_panel .rs_panel>*{flex-shrink:0}
#panel_roadscape_panel .rs_row{display:flex;gap:6px;flex-wrap:wrap}
#panel_roadscape_panel .rs_row button{flex:1 1 auto}
#panel_roadscape_panel .rs_primary{font-weight:600}
#panel_roadscape_panel .rs_status{margin:0;color:var(--color-subtle_text);font-size:.9em;min-height:1.2em}
#panel_roadscape_panel .rs_hint{margin:2px 0;color:var(--color-subtle_text);font-size:.85em}
#panel_roadscape_panel .rs_section{border:1px solid var(--color-border);border-radius:4px}
#panel_roadscape_panel .rs_section>summary{cursor:pointer;padding:5px 8px;font-weight:600}
#panel_roadscape_panel .rs_body{padding:4px 8px 8px;display:flex;flex-direction:column;gap:5px}
#panel_roadscape_panel .rs_field{display:grid;grid-template-columns:minmax(90px,1fr) 100px;gap:6px;align-items:center}
#panel_roadscape_panel .rs_field input[type=checkbox]{justify-self:end}
#panel_roadscape_panel .rs_field input,#panel_roadscape_panel .rs_field select{min-width:0;width:100%}
#panel_roadscape_panel .rs_element{border:1px solid var(--color-border);border-radius:4px;padding:5px 6px;display:flex;flex-direction:column;gap:4px;background:var(--color-back)}
#panel_roadscape_panel .rs_element.rs_off{opacity:.55}
#panel_roadscape_panel .rs_element_head{display:flex;justify-content:space-between;align-items:center;gap:6px}
#panel_roadscape_panel .rs_buttons button{padding:0 6px;min-width:22px}
#panel_roadscape_panel .rs_check{display:flex;gap:6px;align-items:center}
#panel_roadscape_panel .rs_nested{display:flex;flex-direction:column;gap:4px;padding-left:8px;border-left:2px solid var(--color-border)}
#panel_roadscape_panel .rs_side{display:flex;flex-direction:column;gap:5px}
#panel_roadscape_panel .rs_side_head small{color:var(--color-subtle_text);margin-left:4px}
#panel_roadscape_panel .rs_add{display:flex;gap:6px}
#panel_roadscape_panel .rs_add select{flex:1;min-width:0}
#panel_roadscape_panel .rs_stats{display:flex;flex-direction:column;gap:2px;font-size:.9em}
#panel_roadscape_panel .rs_meter{height:6px;border-radius:3px;background:var(--color-border);overflow:hidden}
#panel_roadscape_panel .rs_meter>div{height:100%;background:var(--color-accent)}
#panel_roadscape_panel .rs_meter.rs_over>div{background:#e5645a}
#panel_roadscape_panel .rs_warn{color:#e5a14a;margin:0;font-size:.85em}
#panel_roadscape_panel .rs_breakdown{display:grid;grid-template-columns:1fr auto;gap:0 10px;font-size:.85em;color:var(--color-subtle_text)}
`;
