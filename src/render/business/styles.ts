const DARK_VARS =
  '--bg:#0f1115;--paper:#161b22;--sunk:#12161c;--line:#30363d;--line-soft:#262c34;--text:#e6edf3;--muted:#8b949e;--soft:#c9d1d9;--edge:#79c0ff;--edge-bg:rgba(121,192,255,.12);--new:#3fb950;--new-t:#7ee787;--new-bg:rgba(46,160,67,.18);--new-line:rgba(63,185,80,.4);--chg:#d29922;--chg-t:#f2cc60;--chg-bg:rgba(210,153,34,.16);--chg-line:rgba(210,153,34,.45);--rem:#ff7b72;--rem-bg:rgba(248,81,73,.18);--rem-t:#ffa198;--amber:#d29922;--amber-bg:rgba(210,153,34,.07);--amber-t:#f2cc60;--btn:#2f81f7;--veil:rgba(1,4,9,.7);--bar:rgba(22,27,34,.94)';

export const BUSINESS_CSS = `
:root{color-scheme:light dark;--bg:#f6f8fa;--paper:#fff;--sunk:#fafbfc;--line:#d0d7de;--line-soft:#e6eaef;--text:#1f2328;--muted:#656d76;--soft:#2d333b;--edge:#0969da;--edge-bg:rgba(9,105,218,.07);--new:#2ea043;--new-t:#1a7f37;--new-bg:rgba(46,160,67,.10);--new-line:rgba(46,160,67,.35);--chg:#d29922;--chg-t:#9a6700;--chg-bg:rgba(212,167,44,.13);--chg-line:rgba(212,167,44,.45);--rem:#cf222e;--rem-bg:rgba(255,129,130,.16);--rem-t:#6e2a2e;--amber:#bf8700;--amber-bg:#fff8e5;--amber-t:#7d4e00;--btn:#0969da;--veil:rgba(31,35,40,.45);--bar:rgba(255,255,255,.94);--serif:"Iowan Old Style",Charter,"Palatino Linotype",Palatino,Georgia,serif;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",sans-serif;--r:10px}
:root[data-theme="light"]{color-scheme:light}
:root[data-theme="dark"]{color-scheme:dark}
@media (prefers-color-scheme:dark){:root[data-theme="auto"]{${DARK_VARS}}}
:root[data-theme="dark"]{${DARK_VARS}}
*{box-sizing:border-box}
html{background:var(--bg)}
body{margin:0;color:var(--text);font:15px/1.5 var(--sans);-webkit-font-smoothing:antialiased}
.wrap{max-width:1100px;margin:0 auto;padding:0 28px}
h1,h2,h3{font-family:var(--serif);font-weight:600;letter-spacing:-.01em;margin:0}
button{font:inherit;cursor:pointer}
[hidden]{display:none!important}
header{background:var(--paper);border-bottom:1px solid var(--line);padding:30px 0 24px}
.eyebrow{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;font-size:12.5px;color:var(--muted);margin-bottom:12px}
.brand{font-weight:600;color:var(--text);letter-spacing:.02em}
.brand i{display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--edge);margin-right:7px}
.update{color:var(--chg-t)}
h1{font-size:38px;line-height:1.1;margin-bottom:12px}
.summary{font-size:16.5px;line-height:1.6;max-width:800px;margin:0 0 18px;color:var(--soft)}
.stats{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
.stats a{color:var(--text);text-decoration:none;border:1px solid var(--line);border-radius:99px;padding:4px 12px;font-size:13px;background:var(--bg)}
.stats a b{font-variant-numeric:tabular-nums}
.stats a.q{border-color:var(--edge);color:var(--edge);background:var(--edge-bg);font-weight:600}
.legend{display:flex;flex-wrap:wrap;gap:10px 26px;padding:12px 16px;background:var(--bg);border-radius:var(--r);font-size:13px;color:var(--muted)}
.legend .grp{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center}
.legend .lab{font-weight:600;color:var(--text);font-size:12px;text-transform:uppercase;letter-spacing:.06em}
.ev{display:inline-flex;align-items:center;gap:6px;border-radius:99px;font-size:12px;font-weight:600;padding:2px 10px 2px 4px;white-space:nowrap;line-height:1.5}
.ev::before{display:inline-grid;place-items:center;width:17px;height:17px;border-radius:50%;font-size:11px;font-weight:800}
.ev.ok{background:var(--new-t);color:var(--bg);border:1.5px solid var(--new-t)}
.ev.ok::before{content:"✓";background:var(--bg);color:var(--new-t)}
.ev.guess{background:var(--amber-bg);color:var(--amber-t);border:1.5px dashed var(--amber)}
.ev.guess::before{content:"?";background:var(--amber);color:var(--bg)}
.mk{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;border-radius:4px;padding:1px 6px}
.mk.add{background:var(--new-bg);color:var(--new-t)}
.mk.chg{background:var(--chg-bg);color:var(--chg-t)}
.mk.rem{background:var(--rem-bg);color:var(--rem)}
section{padding:38px 0 6px}
.sec-h{display:flex;align-items:baseline;gap:14px;margin-bottom:6px}
.sec-h .n{font-family:var(--serif);font-size:15px;color:var(--muted)}
h2{font-size:27px}
.sec-sub{color:var(--muted);margin:0 0 20px;max-width:720px}
.card{background:var(--paper);border:1px solid var(--line);border-radius:var(--r);position:relative}
.card.guess{border:2px dashed var(--amber);background:repeating-linear-gradient(-45deg,var(--amber-bg) 0 8px,transparent 8px 16px),var(--paper)}
.card.flash{animation:flash 1.4s ease}
@keyframes flash{0%,40%{box-shadow:0 0 0 4px var(--edge)}100%{box-shadow:0 0 0 0 transparent}}
.journey{margin-bottom:22px;overflow:hidden}
.j-head{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;padding:16px 20px;border-bottom:1px solid var(--line-soft)}
.j-head h3{font-size:20px;flex:1 1 280px}
.actor{display:inline-flex;align-items:center;gap:7px;font-size:13px;color:var(--muted)}
.actor .av{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:var(--edge-bg);color:var(--edge);font-weight:700;font-size:11px}
.j-cols{display:grid;grid-template-columns:1fr 1fr}
.j-col{padding:16px 20px 20px}
.j-col.now{background:var(--sunk);border-right:1px solid var(--line-soft)}
.j-col h4{margin:0 0 12px;font-size:12px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);display:flex;align-items:center;gap:8px}
.j-col.after h4{color:var(--text)}
.j-col h4::after{content:"";flex:1;height:1px;background:var(--line-soft)}
.none{margin:0;color:var(--muted);font-style:italic;font-size:14px}
ol.steps{list-style:none;margin:0;padding:0;counter-reset:s}
.step{position:relative;padding:0 0 12px 36px;counter-increment:s}
.step::before{content:counter(s);position:absolute;left:0;top:1px;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;background:var(--paper);border:1.5px solid var(--line);color:var(--muted);z-index:1}
.step:not(:last-child)::after{content:"";position:absolute;left:11.5px;top:25px;bottom:0;width:1.5px;background:var(--line)}
.step .box{border-radius:8px;padding:7px 11px;font-size:14.5px;border:1px solid transparent}
.step .box .mk{margin-right:6px;vertical-align:1px}
.step.add .box{background:var(--new-bg);border-color:var(--new-line)}
.step.add::before{border-color:var(--new);color:var(--new-t)}
.step.chg .box{background:var(--chg-bg);border-color:var(--chg-line)}
.step.chg::before{border-color:var(--chg);color:var(--chg-t)}
.step.rem .box{background:var(--rem-bg);color:var(--rem-t)}
.step.rem .t{text-decoration:line-through;text-decoration-color:var(--rem)}
.step.rem::before{border-color:var(--rem);color:var(--rem)}
.step.same .box{color:var(--soft);padding-left:2px}
.j-foot,.r-foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}
.j-foot{padding:10px 20px;border-top:1px solid var(--line-soft);background:var(--sunk);font-size:13px}
.rules{display:grid;grid-template-columns:repeat(auto-fill,minmax(400px,1fr));gap:16px;align-items:start}
.rule{padding:16px 18px 14px;display:flex;flex-direction:column;gap:10px}
.r-top{display:flex;justify-content:flex-start;gap:6px 10px;align-items:center;flex-wrap:wrap}
.rule h3{font-size:18px;line-height:1.25}
.ba{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:14px;margin:0}
.ba dt{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);padding-top:3px}
.ba dd{margin:0}
.ba dd.was{color:var(--muted)}
.exc{font-size:13.5px;background:var(--edge-bg);border-radius:6px;padding:6px 10px}
.exc b{color:var(--edge)}
.exc ul{margin:2px 0 0;padding-left:18px}
.r-foot{margin-top:auto;padding-top:6px;position:relative;z-index:1}
.confirm{display:flex;gap:6px;flex-wrap:wrap}
.confirm button,.cbtn{border:1px solid var(--line);background:var(--paper);color:var(--text);border-radius:6px;padding:0 12px;min-height:30px;font-size:13px}
.confirm button[aria-pressed="true"].yes{background:var(--new-t);border-color:var(--new-t);color:var(--bg)}
.confirm button[aria-pressed="true"].no{background:var(--rem);border-color:var(--rem);color:var(--bg)}
.cbtn{color:var(--soft);border-color:var(--muted);display:inline-flex;gap:6px;align-items:center}
.cbtn:hover{color:var(--edge);border-color:var(--edge)}
.cbtn.has{color:var(--edge);border-color:var(--edge);background:var(--edge-bg);font-weight:600}
.cbox{display:none;padding:0 0 4px;position:relative;z-index:2}
.cbox.open{display:block}
.cbox textarea,.qa textarea{width:100%;min-height:62px;resize:vertical;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:14px/1.45 var(--sans);color:var(--text);background:var(--paper)}
.cbox textarea:focus,.qa textarea:focus{outline:2px solid var(--edge);border-color:var(--edge)}
.j-cbox{padding:0 20px 12px;background:var(--sunk)}
.data{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px;align-items:start}
.datum{padding:14px 16px;display:flex;flex-direction:column;gap:8px}
.datum h3{font-family:var(--sans);font-size:15px;font-weight:650;letter-spacing:0}
.datum p{margin:0;font-size:14px;color:var(--soft)}
.datum .why{color:var(--muted)}
.qs{display:grid;gap:14px}
.qa{padding:16px 18px;display:grid;grid-template-columns:34px 1fr;gap:4px 12px;border-left:4px solid var(--edge)}
.qa .qn{font-family:var(--serif);font-size:24px;color:var(--edge);line-height:1}
.qa p{margin:0 0 4px;font-size:16px;font-weight:550}
.qa .about{font-size:12.5px;color:var(--muted);margin-bottom:8px}
.qa .about a{color:var(--edge)}
footer{color:var(--muted);font-size:12.5px;padding:30px 0 10px}
.bar{position:sticky;bottom:0;margin-top:20px;background:var(--bar);backdrop-filter:blur(6px);border-top:1px solid var(--line);z-index:10}
.bar .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:12px;padding-bottom:12px;flex-wrap:wrap}
.bar .count{font-size:14px;color:var(--muted)}
.bar .count b{color:var(--text);font-variant-numeric:tabular-nums}
.send{background:var(--btn);color:#fff;border:0;border-radius:8px;padding:9px 18px;font-weight:600;font-size:14.5px}
.send:disabled{background:var(--muted);cursor:not-allowed;opacity:.6}
.modal{position:fixed;inset:0;background:var(--veil);display:none;place-items:center;z-index:20;padding:20px}
.modal:not([hidden]){display:grid}
.sheet{background:var(--paper);border-radius:12px;max-width:640px;width:100%;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.25)}
.sheet h3{font-size:21px;margin-bottom:4px}
.sheet p{margin:0 0 12px;color:var(--muted);font-size:14px}
.sheet pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px 14px;white-space:pre-wrap;overflow-wrap:anywhere;font:13.5px/1.55 var(--sans);max-height:50vh;overflow:auto;margin:0 0 14px}
.sheet .row{display:flex;justify-content:flex-end;gap:8px}
.sheet .row button{border:1px solid var(--line);background:var(--paper);color:var(--text);border-radius:8px;padding:7px 14px}
.sheet .row .send{border:0;background:var(--btn);color:#fff}
@media (max-width:760px){.wrap{padding:0 16px}h1{font-size:30px}.j-cols{grid-template-columns:1fr}.j-col.now{border-right:0;border-bottom:1px solid var(--line-soft)}.rules{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){.card.flash{animation:none;box-shadow:0 0 0 3px var(--edge)}}
`;
