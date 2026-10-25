/** Dialog layout: preview on the left, scrolling form on the right (same pattern as the building dialog). */
export const TREE_DIALOG_CSS = `
#tree_generator_dialog .dialog_content {display:grid;grid-template-columns:minmax(300px,1fr) 360px;gap:22px;max-height:calc(100vh - 190px);overflow:auto;}
#tree_generator_dialog .tree_view {min-width:0;position:sticky;top:0;align-self:start;}
#tree_generator_dialog .tree_view canvas {width:100%;height:min(560px,calc(100vh - 330px));min-height:280px;display:block;border-radius:8px;touch-action:none;cursor:grab;}
#tree_generator_dialog .tree_heading {display:flex;justify-content:space-between;gap:8px;font-size:10px;letter-spacing:1px;color:var(--color-subtle_text);margin:0 0 10px;}
#tree_generator_dialog .tree_stats {font-size:12px;padding-top:12px;}
#tree_generator_dialog .tree_hint {font-size:11px;color:var(--color-subtle_text);padding-top:6px;}
#tree_generator_dialog .tree_error {color:#f2ac78;}
#tree_generator_dialog .form {display:block;}
@media(max-width:800px){#tree_generator_dialog .dialog_content{grid-template-columns:1fr;}#tree_generator_dialog .tree_view{position:static;}#tree_generator_dialog .tree_view canvas{height:320px;}}
`;
