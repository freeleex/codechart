const VARS =
  '--bg:#e9ecef;--paper:#fff;--sunk:#fafbfc;--line:#d0d7de;--line-soft:#e6eaef;--text:#1f2328;--muted:#656d76;--soft:#2d333b;--edge:#0969da;--new:#2ea043;--new-t:#1a7f37;--new-bg:rgba(46,160,67,.10);--new-line:rgba(46,160,67,.35);--chg:#d29922;--chg-t:#9a6700;--chg-bg:rgba(212,167,44,.13);--rem:#cf222e;--rem-bg:rgba(255,129,130,.16);--rem-t:#6e2a2e';

const BASE = `
:root{color-scheme:light;${VARS};--serif:"Iowan Old Style",Charter,"Palatino Linotype",Palatino,Georgia,serif;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",sans-serif}
*{box-sizing:border-box}
html{background:var(--bg)}
body{margin:0;color:var(--text);font:11pt/1.5 var(--sans);-webkit-font-smoothing:antialiased;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1,h2,h3{font-family:var(--serif);font-weight:600;letter-spacing:-.01em;margin:0}
img{display:block;object-fit:contain}
.cover img{max-height:28mm;max-width:70mm;margin-bottom:12mm}
.cover{padding-top:60mm;break-after:page}
.co-product{font-size:13pt;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.cover h1{font-size:34pt;line-height:1.1;margin:4mm 0 3mm}
.co-meta{font-size:12pt;color:var(--muted);margin-bottom:10mm}
.summary{font-size:14pt;line-height:1.6;margin:0;color:var(--soft)}
.co-counts{margin-top:10mm;color:var(--soft)}
.feature{margin:0 0 10mm;padding-top:8mm;border-top:1px solid var(--line)}
.feature:first-of-type{border-top:0;padding-top:0}
.f-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin-bottom:6px}
.f-head h2{font-size:20pt;flex:1 1 60%}
.f-head,.f-sum,.f-sub{break-after:avoid}
.f-head,.f-sum{break-inside:avoid}
.chg-badge{font-size:8.5pt;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border-radius:4px;padding:2px 8px}
.chg-new{background:var(--new-bg);color:var(--new-t)}
.chg-changed{background:var(--chg-bg);color:var(--chg-t)}
.chg-fixed{background:rgba(9,105,218,.07);color:var(--edge)}
.f-sum{margin:0 0 14px;font-size:12pt;color:var(--soft)}
.f-sub{margin:16px 0 8px;font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--muted)}
.card{background:var(--paper);border:1px solid var(--line);border-radius:8px;break-inside:avoid;margin-bottom:10px}
.mk{display:inline-block;font-size:8.5pt;font-weight:700;letter-spacing:.04em;text-transform:uppercase;border-radius:4px;padding:1px 6px}
.mk.add{background:var(--new-bg);color:var(--new-t)}
.mk.chg{background:var(--chg-bg);color:var(--chg-t)}
.mk.rem{background:var(--rem-bg);color:var(--rem)}
.j-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;padding:10px 14px;border-bottom:1px solid var(--line-soft)}
.j-head h3{font-size:13pt;flex:1 1 60%}
.who{font-size:9.5pt;color:var(--muted)}
.j-cols{display:grid;grid-template-columns:1fr 1fr}
.j-col{padding:10px 14px}
.j-col:first-child{background:var(--sunk);border-right:1px solid var(--line-soft);border-radius:0 0 0 8px}
.j-col h4{margin:0 0 8px;font-size:8.5pt;text-transform:uppercase;letter-spacing:.09em;color:var(--muted)}
.none{margin:0;color:var(--muted);font-style:italic;font-size:10pt}
ol.steps{margin:0;padding:0 0 0 18px;font-size:10.5pt}
.step{padding:2px 0}
.step.rem .t{text-decoration:line-through;text-decoration-color:var(--rem)}
.rules,.data{display:grid;grid-template-columns:1fr;gap:0}
.rule,.datum{padding:10px 14px}
.rule h3,.datum h3{font-size:12.5pt;margin:4px 0 6px}
.ba{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:10.5pt;margin:0}
.ba dt{font-size:8.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);padding-top:3px}
.ba dd{margin:0}
.ba dd.was{color:var(--muted)}
.exc{font-size:10pt;margin-top:8px}
.exc ul{margin:2px 0 0;padding-left:18px}
.datum p{margin:0;font-size:10.5pt;color:var(--soft)}
.datum .why{color:var(--muted)}
footer{color:var(--muted);font-size:9pt;padding-top:6mm}
`;

const SCREEN = `
@media screen{
body{padding:24px 12px}
.sheet{max-width:210mm;margin:0 auto 24px;background:#fff;padding:18mm 16mm 20mm;box-shadow:0 2px 16px rgba(0,0,0,.18)}
.cover{min-height:225mm;border-bottom:1px dashed var(--line);margin-bottom:10mm}
}
@media screen and (max-width:640px){.j-cols{grid-template-columns:1fr}.j-col:first-child{border-right:0;border-bottom:1px solid var(--line-soft)}.cover h1{font-size:26pt}}
`;

const PRINT = `
@page{size:A4;margin:18mm 16mm 20mm;@bottom-right{content:counter(page);font:9pt sans-serif;color:#656d76}}
@page:first{@bottom-right{content:none}}
@media print{html,body{background:#fff}}
`;

/** One light palette and one layout: the page on screen is the page on paper. */
export const RELEASE_CSS = BASE + SCREEN + PRINT;
