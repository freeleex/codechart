const DARK_VARS =
  '--bg:#0f1115;--panel:#161b22;--card:#161b22;--line:#30363d;--text:#c9d1d9;--muted:#8b949e;--edge:#79c0ff;--new:#3fb950;--new-t:#7ee787;--chg:#d29922;--chg-t:#f2cc60;--cfg:#a371f7;--cfg-t:#d2a8ff;--add:#7ee787;--rem:#ff7b72';
const DARK_AUTO = `@media (prefers-color-scheme: dark){:root[data-theme="auto"]{${DARK_VARS}}}`;
const DARK_FORCED = `:root[data-theme="dark"]{${DARK_VARS}}`;

export const CSS = `
:root{color-scheme:light dark;--bg:#f6f8fa;--panel:#fff;--card:#fff;--line:#d0d7de;--text:#1f2328;--muted:#656d76;--edge:#0969da;--new:#2ea043;--new-t:#1a7f37;--chg:#d29922;--chg-t:#9a6700;--cfg:#8957e5;--cfg-t:#8250df;--add:#1a7f37;--rem:#cf222e}
:root[data-theme="light"]{color-scheme:light}
:root[data-theme="dark"]{color-scheme:dark}
${DARK_AUTO}
${DARK_FORCED}
*{box-sizing:border-box}
body{margin:0;height:100vh;display:flex;flex-direction:column;background:var(--bg);color:var(--text);font:13px system-ui,sans-serif}
header{padding:8px 14px;border-bottom:1px solid var(--line);background:var(--panel);display:flex;gap:12px;align-items:baseline}
header h1{margin:0;font-size:15px}
header .meta{color:var(--muted);font-size:11px;margin-right:auto}
header .update{font-size:11px;color:var(--chg-t)}header .update code{font:11px ui-monospace,monospace}
main{flex:1;display:flex;min-height:0}
.canvas{flex:1;min-width:0;min-height:0;cursor:grab;overflow:hidden;touch-action:none}
.canvas.drag{cursor:grabbing}
.canvas svg{width:100%;height:100%;display:block}
#panes{flex:1;min-width:0;display:flex}
.pane{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
.pane+.pane{border-left:1px solid var(--line)}
#panes~aside{width:clamp(200px,17.5vw,300px);min-width:200px}
.pane-title{padding:4px 10px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line)}
.pane-key{font-weight:400;text-transform:none}.k-rem{color:var(--rem)}.k-new{color:var(--new-t)}.k-chg{color:var(--chg-t)}.k-cfg{color:var(--cfg-t)}
@media (max-width:900px){#panes{flex-direction:column}.pane+.pane{border-left:0;border-top:1px solid var(--line)}}
aside{width:clamp(300px,35vw,600px);min-width:300px;max-width:80vw;border-left:1px solid var(--line);background:var(--panel);overflow:auto;padding:10px 14px}
#resize{flex:none;width:5px;margin-right:-5px;position:relative;z-index:1;cursor:col-resize;touch-action:none}
#resize:hover,#resize:focus-visible,#resize.drag{background:var(--edge);outline:none}
#panel-nav{float:right;display:flex;gap:4px;margin:0 0 4px 8px}
#panel-nav button{padding:0 7px;font:13px/20px system-ui,sans-serif;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:10px;cursor:pointer}
#panel-nav button:hover:not(:disabled){border-color:var(--edge)}#panel-nav button:disabled{opacity:.4;cursor:default}
aside h2{margin:0 0 6px;font-size:13px;overflow-wrap:anywhere}
aside h3{margin:12px 0 4px;font-size:11px;text-transform:uppercase;color:var(--muted)}
aside ul{margin:0;padding-left:18px}
aside .tick-row{display:block;margin:0 0 6px;color:var(--muted)}
aside .relations{list-style:none;padding:0}
aside .rel{padding:1px 0;font:inherit;color:var(--edge);background:none;border:0;cursor:pointer;text-align:left;overflow-wrap:anywhere}aside .rel:hover{text-decoration:underline}
aside .fields-note{color:var(--muted);font-size:11.5px;font-style:italic;margin:6px 0 0}
aside code{font-family:ui-monospace,monospace;font-size:11px;font-style:normal}
aside .path{font-family:ui-monospace,monospace;font-size:11px;overflow-wrap:anywhere;color:var(--muted)}
aside .snippet{font:11px/1.45 ui-monospace,monospace;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:6px 8px;margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere}
aside .snippet code{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:10px}
aside .snippet .ln{min-width:3ch;color:var(--muted);text-align:right;user-select:none}
aside .d-add{color:var(--add)}aside .d-del{color:var(--rem)}aside .d-hunk{color:var(--muted)}
aside .mismatch-note{color:var(--rem);margin:6px 0}
aside .mismatch-why{color:var(--muted);font-size:11.5px;margin:0 0 6px}
header .check{font-size:11px;color:var(--new-t)}header .check.bad{color:var(--rem);font-weight:600;font-family:inherit;background:none;border:0;padding:0;cursor:pointer;text-decoration:underline dotted}
.node .flag{fill:var(--rem);font-size:13px;font-weight:700;text-anchor:middle}
.group rect{fill:none;stroke:var(--line);stroke-dasharray:4 3}
.group text{fill:var(--muted);font-size:10px;text-transform:uppercase}
.edge path{fill:none;stroke:var(--edge);stroke-width:1.2}
.edge text{fill:var(--edge);font-size:9.5px;text-anchor:middle}
.edge rect{fill:var(--bg);opacity:.9}
#arrow path{fill:var(--edge)}
.edge-added path{stroke:var(--new)}.edge-added text{fill:var(--new-t)}#arrow-added path{fill:var(--new)}
.edge-removed path{stroke:var(--rem);stroke-dasharray:5 3}.edge-removed text{fill:var(--rem)}#arrow-removed path{fill:var(--rem);stroke:none}
.node{cursor:pointer}
.node,.edge{opacity:calc(var(--base,1)*var(--fade,1)*var(--dim,1))}
#toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;padding:4px 14px;min-height:24px;background:var(--bg);border-bottom:1px solid var(--line);font-size:11px}
#chips{display:flex;flex-wrap:wrap;gap:4px;margin-right:auto}
#review{display:flex;align-items:center;gap:8px;color:var(--muted)}
#review-bar{width:60px;height:3px;border-radius:2px;background:var(--line);overflow:hidden}
#review-bar i{display:block;height:100%;width:0;background:var(--new)}
.chip{padding:0 7px;font:10.5px/16px system-ui,sans-serif;color:var(--muted);background:var(--panel);border:1px solid currentColor;border-radius:10px;cursor:pointer}
.chip-new{color:var(--new-t)}.chip-changed{color:var(--chg-t)}.chip-removed{color:var(--rem)}.chip-planned,.chip-config{color:var(--cfg-t)}
.chip-planned{border-style:dashed}.chip-delta{color:var(--text);border-color:var(--line)}
.chip[aria-pressed="true"]{opacity:.5;text-decoration:line-through}
.chip-delta[aria-pressed="true"]{opacity:1;text-decoration:none;border-color:var(--edge)}
.node.faded,.edge.faded{--fade:.15}
body.focus .node:not(.lit),body.focus .edge:not(.lit){--dim:.25}
.node .card{fill:var(--card);stroke:var(--line);stroke-width:1}
.node .fold{fill:none;stroke:var(--line);stroke-width:1}
.node .head{stroke:var(--line);stroke-width:1}
.node .kind{fill:var(--muted);font-size:8px;letter-spacing:.06em;text-transform:uppercase}
.node .label{fill:var(--text);font-size:11px;font-weight:600}
.node .badge{font-size:8.5px;text-transform:uppercase;text-anchor:end}
.node .summary{fill:var(--muted);font-size:10.5px;font-style:italic}
.node .field{fill:var(--text);font-size:10.5px}
.node .field-added{fill:var(--add)}
.node .field-removed{fill:var(--rem);text-decoration:line-through}
.node .field-modified{fill:var(--chg-t)}
.tick{cursor:pointer}.tick-hit{fill:transparent}
.tick-box{fill:var(--card);stroke:var(--muted);stroke-width:1}
.tick-mark{display:none;fill:none;stroke:var(--card);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.node.reviewed :is(.card,.fold,.shape){stroke:var(--muted)}
.node.reviewed .tick-box{fill:var(--muted)}.node.reviewed .tick-mark{display:inline}
.node.selected .card{stroke-width:2.5}
.node:focus{outline:none}
.node:focus-visible .card{stroke:var(--edge);stroke-width:3.5}
.status-new :is(.card,.fold){stroke:var(--new)}.status-new .badge{fill:var(--new-t)}
.status-changed :is(.card,.fold){stroke:var(--chg)}.status-changed .badge{fill:var(--chg-t)}
.status-removed :is(.card,.fold){stroke:var(--rem)}.status-removed .badge{fill:var(--rem)}.status-removed .label{text-decoration:line-through}
.status-config :is(.card,.fold){stroke:var(--cfg)}.status-config .badge{fill:var(--cfg-t)}
.status-context .card{stroke-dasharray:4 3}.status-context{--base:.75}.status-context .badge{fill:var(--muted)}
.field-added-t{color:var(--add)}.field-removed-t{color:var(--muted);text-decoration:line-through}.field-modified-t{color:var(--chg-t)}

#info-toggle[aria-expanded="true"]{border-color:var(--edge)}
#info-toggle,#link-toggle,#theme-toggle{align-self:center;padding:4px 10px;font:11px system-ui,sans-serif;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:12px;cursor:pointer}
#info-toggle:hover,#link-toggle:hover,#theme-toggle:hover,#next-unreviewed:hover:not(:disabled){border-color:var(--edge)}
#next-unreviewed{padding:0 8px;font:10.5px/16px system-ui,sans-serif;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:10px;cursor:pointer}
#next-unreviewed:disabled{opacity:.4;cursor:default}
`;
