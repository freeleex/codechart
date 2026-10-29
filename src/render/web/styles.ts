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
main{flex:1;display:flex;min-height:0}
#canvas{flex:1;min-width:0;cursor:grab;overflow:hidden;touch-action:none}
#canvas.drag{cursor:grabbing}
#canvas svg{width:100%;height:100%;display:block}
aside{width:300px;border-left:1px solid var(--line);background:var(--panel);overflow:auto;padding:10px 14px}
aside h2{margin:0 0 6px;font-size:13px}
aside h3{margin:12px 0 4px;font-size:11px;text-transform:uppercase;color:var(--muted)}
aside ul{margin:0;padding-left:18px}
aside .fields-note{color:var(--muted);font-size:11.5px;font-style:italic;margin:6px 0 0}
aside code{font-family:ui-monospace,monospace;font-size:11px;font-style:normal}
aside .path{font-family:ui-monospace,monospace;font-size:11px;word-break:break-all;color:var(--muted)}
.group rect{fill:none;stroke:var(--line);stroke-dasharray:4 3}
.group text{fill:var(--muted);font-size:10px;text-transform:uppercase}
.edge path{fill:none;stroke:var(--edge);stroke-width:1.2}
.edge text{fill:var(--edge);font-size:9.5px;text-anchor:middle}
.edge rect{fill:var(--bg);opacity:.9}
#arrow path{fill:var(--edge)}
.node{cursor:pointer}
.node .card{fill:var(--card);stroke:var(--line);stroke-width:1}
.node .head{stroke:var(--line);stroke-width:1}
.node .label{fill:var(--text);font-size:11px;font-weight:600}
.node .badge{font-size:8.5px;text-transform:uppercase;text-anchor:end}
.node .summary{fill:var(--muted);font-size:10.5px;font-style:italic}
.node .field{fill:var(--text);font-size:10.5px}
.node .field-added{fill:var(--add)}
.node .field-removed{fill:var(--rem);text-decoration:line-through}
.node .field-modified{fill:var(--chg-t)}
.node.selected .card{stroke-width:2.5}
.node:focus{outline:none}
.node:focus-visible .card{stroke:var(--edge);stroke-width:3.5}
.status-new .card{stroke:var(--new)}.status-new .badge{fill:var(--new-t)}
.status-changed .card{stroke:var(--chg)}.status-changed .badge{fill:var(--chg-t)}
.status-removed .card{stroke:var(--rem)}.status-removed .badge{fill:var(--rem)}.status-removed .label{text-decoration:line-through}
.status-config .card{stroke:var(--cfg)}.status-config .badge{fill:var(--cfg-t)}
.status-context .card{stroke-dasharray:4 3}.status-context{opacity:.75}.status-context .badge{fill:var(--muted)}
.field-added-t{color:var(--add)}.field-removed-t{color:var(--muted);text-decoration:line-through}.field-modified-t{color:var(--chg-t)}

#info-toggle[aria-expanded="true"]{border-color:var(--edge)}
#info-toggle,#theme-toggle{align-self:center;padding:4px 10px;font:11px system-ui,sans-serif;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:12px;cursor:pointer}
#info-toggle:hover,#theme-toggle:hover{border-color:var(--edge)}
`;
