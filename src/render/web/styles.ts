const DARK_VARS =
  '--bg:#0f1115;--panel:#161b22;--card:#161b22;--line:#30363d;--text:#c9d1d9;--muted:#8b949e;--edge:#79c0ff;--new:#3fb950;--new-t:#7ee787;--chg:#d29922;--chg-t:#f2cc60;--cfg:#a371f7;--cfg-t:#d2a8ff;--add:#7ee787;--rem:#ff7b72;--add-bg:rgba(46,160,67,.22);--rem-bg:rgba(248,81,73,.22);--gap-bg:rgba(110,118,129,.12);--hh-bg:rgba(56,139,253,.10);--hh-line:rgba(56,139,253,.28);--ln:#484f58;--ln-add:rgba(126,231,135,.55);--ln-rem:rgba(255,123,114,.55)';
const DARK_AUTO = `@media (prefers-color-scheme: dark){:root[data-theme="auto"]{${DARK_VARS}}}`;
const DARK_FORCED = `:root[data-theme="dark"]{${DARK_VARS}}`;

export const CSS = `
:root{color-scheme:light dark;--bg:#f6f8fa;--panel:#fff;--card:#fff;--line:#d0d7de;--text:#1f2328;--muted:#656d76;--edge:#0969da;--new:#2ea043;--new-t:#1a7f37;--chg:#d29922;--chg-t:#9a6700;--cfg:#8957e5;--cfg-t:#8250df;--add:#1a7f37;--rem:#cf222e;--add-bg:rgba(46,160,67,.18);--rem-bg:rgba(255,129,130,.25);--gap-bg:rgba(110,118,129,.12);--hh-bg:rgba(9,105,218,.07);--hh-line:rgba(9,105,218,.22);--ln:var(--muted);--ln-add:rgba(26,127,55,.6);--ln-rem:rgba(207,34,46,.6)}
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
aside{width:clamp(300px,35vw,600px);min-width:300px;max-width:80vw;border-left:1px solid var(--line);background:var(--panel);display:flex;flex-direction:column;overflow:hidden}
#aside-scroll{flex:1;min-height:0;overflow:auto;padding:10px 14px}
#panel-rel{flex:none;max-height:35vh;overflow:auto;padding:0 14px 10px;border-top:1px solid var(--line);background:var(--panel)}#panel-rel[hidden]{display:none}
#resize{flex:none;width:5px;margin-right:-5px;position:relative;z-index:1;cursor:col-resize;touch-action:none}
#resize:hover,#resize:focus-visible,#resize.drag{background:var(--edge);outline:none}
#panel-nav{float:right;display:flex;gap:4px;margin:0 0 4px 8px}
#panel-nav button{padding:0 7px;font:13px/20px system-ui,sans-serif;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:10px;cursor:pointer}
#panel-nav button:hover:not(:disabled){border-color:var(--edge)}#panel-nav button:disabled{opacity:.4;cursor:default}
aside h2{margin:0 0 6px;font-size:13px;overflow-wrap:anywhere}
aside .ptitle{display:flex;gap:7px;align-items:flex-start;min-height:26px;margin-bottom:8px;line-height:1.35}aside .ptitle input{flex:none;margin:2px 0 0}
aside .phead{border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:12px}aside .phead .ptitle{margin-bottom:0}aside .psub{margin:4px 0 0;color:var(--muted);font-size:12.5px;line-height:1.4}
aside h3{margin:12px 0 4px;font-size:11px;text-transform:uppercase;color:var(--muted)}
aside h3.ch-head{display:flex;justify-content:space-between;align-items:baseline}aside .ch-head .fh-stat{flex:none;font:11px ui-monospace,monospace;text-transform:none}aside .ch-head .ch-path{flex:1;min-width:0;margin:0 8px;font:400 11px ui-monospace,monospace;text-transform:none;color:var(--text);overflow-wrap:anywhere}
aside h4{margin:0 0 2px;font-size:11px;font-weight:600;color:var(--muted)}
aside ul{margin:0;padding-left:18px}
aside .relations{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:6px 14px}
aside .rel-col ul{list-style:none;padding:0}aside .rel-none{margin:0;color:var(--muted);font-style:italic}
aside .rel{padding:1px 0;font:inherit;color:var(--edge);background:none;border:0;cursor:pointer;text-align:left;overflow-wrap:anywhere}aside .rel:hover{text-decoration:underline}
aside .fields-note{color:var(--muted);font-size:11.5px;font-style:italic;margin:6px 0 0}
aside code{font-family:ui-monospace,monospace;font-size:11px;font-style:normal}
aside .path{font-family:ui-monospace,monospace;font-size:11px;overflow-wrap:anywhere;color:var(--muted)}
aside .snippet{font:11px/1.45 ui-monospace,monospace;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:6px 8px;margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere}
aside .snippet code{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:10px}
aside .snippet .ln{min-width:3ch;color:var(--muted);text-align:right;user-select:none}
aside .snippet.diff{background:none;border:0;border-radius:0;padding:0;margin:2px 0}
aside .snippet.diff code{display:flex;flex-direction:column}
aside .dr{display:flex;padding:0 14px 0 4px}
aside .dr .ln{flex:none;width:4.5ch;min-width:0;color:var(--ln);text-align:right;user-select:none}
aside .dr .sg{flex:none;width:2.4ch;text-align:center;user-select:none}
aside .ind{white-space:pre;tab-size:4}aside .dr .cd{flex:1;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}
aside .dr.d-add{background:var(--add-bg)}aside .dr.d-add .ln{color:var(--ln-add)}aside .dr.d-add .sg{color:var(--add)}
aside .dr.d-del{background:var(--rem-bg)}aside .dr.d-del .ln{color:var(--ln-rem)}aside .dr.d-del .sg{color:var(--rem)}
aside .n-add{color:var(--add)}aside .n-del{color:var(--rem)}
aside .cgap{display:flex;flex-direction:column}aside .cgap .gap-rows{display:none;flex-direction:column}aside .cgap.open .gap-rows{display:flex}
aside .gap{display:flex;width:100%;padding:2px 14px 2px calc(4px + 4.5ch);font:11px ui-monospace,monospace;color:var(--muted);background:var(--gap-bg);text-align:left;white-space:nowrap}
aside button.gap{border:0;cursor:pointer}aside button.gap:hover{color:var(--text)}
aside .snippet.block{padding:0;overflow:hidden}
aside .snippet.block code,aside .snippet.block .cgap.open .gap-rows{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:10px;padding:0 8px}
aside .snippet.block .gap{padding-left:calc(8px + 5ch)}aside .snippet.block .gap-out{grid-column:1/-1}
aside .snippet.block .ln{min-width:5ch}
aside .snippet.block .hit,aside .snippet.block .ln:has(+.hit){background:var(--hh-bg)}aside .snippet.block .ln:has(+.hit){color:var(--text)}
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
.chip-planned,.chip-outside{border-style:dashed}.chip-delta{color:var(--text);border-color:var(--line)}
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
.node.selected{filter:drop-shadow(0 0 6px color-mix(in srgb,var(--edge) 45%,transparent))}
.node.selected :is(.card,.shape){stroke-width:3}
.node:focus{outline:none}
.node:focus-visible .card{stroke:var(--edge);stroke-width:3.5}
.status-new :is(.card,.fold){stroke:var(--new)}.status-new .badge{fill:var(--new-t)}
.status-changed :is(.card,.fold){stroke:var(--chg)}.status-changed .badge{fill:var(--chg-t)}
.status-removed :is(.card,.fold){stroke:var(--rem)}.status-removed .badge{fill:var(--rem)}.status-removed .label{text-decoration:line-through}
.status-config :is(.card,.fold){stroke:var(--cfg)}.status-config .badge{fill:var(--cfg-t)}
:is(.status-context,.status-outside) .card{stroke-dasharray:4 3}:is(.status-context,.status-outside){--base:.75}:is(.status-context,.status-outside) .badge{fill:var(--muted)}
.field-added-t{color:var(--add)}.field-removed-t{color:var(--muted);text-decoration:line-through}.field-modified-t{color:var(--chg-t)}

#info-toggle[aria-expanded="true"]{border-color:var(--edge)}
#info-toggle,#link-toggle,#theme-toggle{align-self:center;padding:4px 10px;font:11px system-ui,sans-serif;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:12px;cursor:pointer}
#info-toggle:hover,#link-toggle:hover,#theme-toggle:hover,#next-unreviewed:hover:not(:disabled){border-color:var(--edge)}
#next-unreviewed{padding:0 8px;font:10.5px/16px system-ui,sans-serif;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:10px;cursor:pointer}
#next-unreviewed:disabled{opacity:.4;cursor:default}
aside .file{margin:6px -14px}
aside .hunk{border-left:3px solid transparent}aside .hunk+.hunk{margin-top:4px}
aside .hunk.cur{border-left-color:var(--edge)}
aside .hh{display:flex;gap:8px;align-items:baseline;width:100%;padding:2px 14px 2px 5px;font:11px ui-monospace,monospace;color:var(--muted);background:var(--hh-bg);border:0;border-top:1px solid var(--hh-line);border-bottom:1px solid var(--hh-line);text-align:left;white-space:nowrap;overflow:hidden}
aside button.hunk-sum{cursor:pointer}aside button.hunk-sum:hover{color:var(--text)}
aside .hh>*{flex:none}
aside .hh .caret{width:1ch}aside .hh .caret::before{content:"\\2304"}aside .hunk.folded .hh .caret::before{content:"\\203A"}
aside .hh .hs-fn{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--edge)}
aside .hh .hs-first{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis}
aside .hh .hs-stat{margin-left:auto}
aside .hunk:not(.folded) .hs-first{display:none}
aside .hunk.folded .hunk-body,aside .hunk.folded .gap-out{display:none}
aside .hunk-end{margin:6px 0;color:var(--muted);font-size:11px;font-style:italic}
#key-help{position:fixed;right:14px;bottom:14px;z-index:5;padding:8px 12px;font-size:11.5px;line-height:1.6;background:var(--panel);border:1px solid var(--line);border-radius:6px;box-shadow:0 2px 8px #0003;cursor:pointer}
#key-help[hidden]{display:none}
aside .pager{position:sticky;top:-10px;z-index:2;display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;margin:0 -14px 4px;padding:14px 14px 4px;background:var(--panel);border-bottom:1px solid var(--line);font-size:11px;color:var(--muted)}
aside .pager button{padding:0 7px;font:13px/20px system-ui,sans-serif;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:10px;cursor:pointer}
aside .pager button:hover,aside .pager button:focus-visible{border-color:var(--edge)}aside .pager button:focus:not(:focus-visible){outline:none}
aside .pager .pg-count{flex:1;min-width:0;text-align:center;white-space:nowrap}
aside .pager .pg-keys{margin-left:auto;font-size:11px}aside .pager .pg-all{font:11px/20px system-ui,sans-serif}
#finish-review{align-self:center;padding:4px 12px;font:600 11px system-ui,sans-serif;color:#fff;background:var(--edge);border:1px solid var(--edge);border-radius:12px;cursor:pointer}
#finish-review[hidden]{display:none}#finish-review:hover{filter:brightness(1.1)}
.cm-btn{padding:0 6px;font:11px/18px system-ui,sans-serif;color:var(--muted);background:var(--panel);border:1px solid var(--line);border-radius:10px;cursor:pointer}
.cm-btn:hover,.cm-btn:focus-visible{color:var(--text);border-color:var(--edge)}
header .cm-title-btn{align-self:center;margin-left:-6px}
aside .cm-node-btn{margin:0 0 0 auto}
aside li .cm-btn{margin-left:6px}
aside .drift{position:relative}aside .drift-chip~.cm-drift-btn{position:absolute;top:9px;right:34px}
aside .dr .ln{position:relative;cursor:default}
body.cm aside .dr:hover .ln::before{content:"+";position:absolute;inset:0;display:block;text-align:center;font-weight:700;color:#fff;background:var(--edge);cursor:pointer}
.cm-thread{margin:4px 0;padding:4px 8px;font:12px/1.4 system-ui,sans-serif;white-space:normal;background:var(--bg);border:1px solid var(--line);border-radius:4px}
aside .cm-thread{margin-right:14px}aside .dr+.cm-thread{margin-left:calc(4px + 4.5ch)}
.cm-float{position:fixed;z-index:6;width:320px;background:var(--panel);box-shadow:0 2px 10px #0004}
.cm-k-comment{--k:var(--chg)}.cm-k-question{--k:var(--edge)}.cm-k-delete{--k:var(--rem)}
.cm-note{display:flex;gap:6px;align-items:baseline;padding:2px 0 2px 7px;border-left:3px solid var(--k)}
.cm-note.sent{opacity:.5}
.cm-kind{flex:none;font-size:10.5px;text-transform:uppercase;color:var(--k)}
.cm-body{flex:1;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}
.cm-actions{display:flex;gap:6px}
.cm-note .cm-actions{flex:none}
.cm-thread button:not(.cm-btn),.cm-dialog button{padding:0 8px;font:11px/18px system-ui,sans-serif;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:10px;cursor:pointer}
.cm-thread button:hover,.cm-dialog button:hover{border-color:var(--edge)}
.cm-composer{display:flex;flex-direction:column;gap:6px;padding:4px 0 4px 7px;border-left:3px solid var(--k)}
.cm-composer textarea,.cm-preview{width:100%;padding:5px 7px;font:12px/1.4 system-ui,sans-serif;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:4px;resize:vertical}
.cm-kinds{display:flex;gap:4px}
.cm-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px}
.cm-composer .cm-actions{margin-left:auto}
.cm-composer .cm-kinds button[aria-pressed="true"]{color:var(--k);border-color:var(--k);font-weight:600}
.cm-composer button.cm-save{color:#fff;background:var(--new);border-color:var(--new);font-weight:600}
.cm-composer button.cm-cancel{color:var(--muted);background:none;border-color:transparent}
.cm-composer button.cm-cancel:hover{color:var(--text)}
.cm-badge{pointer-events:none}.cm-badge circle{fill:var(--edge)}.cm-badge text{fill:#fff;font-size:9px;font-weight:700;text-anchor:middle}
.cm-hit{fill:none;stroke:transparent;stroke-width:14px;pointer-events:stroke}
.cm-edge-btn{cursor:pointer;opacity:0}
.edge:hover .cm-edge-btn,.cm-edge-btn.has,.cm-edge-btn:focus{opacity:1}.cm-edge-btn:focus{outline:none}
.cm-edge-btn circle{fill:var(--panel);stroke:var(--edge)}.cm-edge-btn.has circle{fill:var(--edge)}
.cm-edge-btn text{font-size:9px;text-anchor:middle;fill:var(--text)}.cm-edge-btn.has text{fill:#fff;font-weight:700}
.cm-modal{position:fixed;inset:0;z-index:10;display:grid;place-items:center;background:#0006}
.cm-dialog{width:min(560px,92vw);padding:14px 16px;background:var(--panel);border:1px solid var(--line);border-radius:8px;box-shadow:0 4px 18px #0006}
.cm-dialog h2{margin:0 0 6px;font-size:14px}.cm-dialog p{margin:0 0 8px}
.cm-preview{font:11px/1.4 ui-monospace,monospace}
.cm-dialog .cm-actions{margin:8px 0}.cm-dialog .cm-copy{color:#fff;background:var(--edge);border-color:var(--edge)}
.cm-alt,.cm-hint{color:var(--muted);font-size:11.5px}.cm-hint{color:var(--chg-t)}.cm-hint[hidden]{display:none}
.cm-toast{position:fixed;right:14px;bottom:14px;z-index:11;padding:6px 12px;font-size:12px;color:#fff;background:var(--new);border-radius:6px}
`;
