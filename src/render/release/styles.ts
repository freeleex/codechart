import { BUSINESS_CSS, LIGHT_VARS } from '../business/styles.js';

const SCREEN_CSS = `
.rel-id{display:inline-flex;align-items:center;gap:8px;color:var(--text);font-weight:600}
.rel-id img,.cover img{display:block;object-fit:contain}
.rel-id img{height:22px;max-width:90px}
.stats .pill{border:1px solid var(--line);border-radius:99px;padding:4px 12px;font-size:13px;background:var(--bg);color:var(--text)}
.pill b{font-variant-numeric:tabular-nums}
.chg-badge{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border-radius:4px;padding:2px 8px}
.chg-new{background:var(--new-bg);color:var(--new-t)}
.chg-changed{background:var(--chg-bg);color:var(--chg-t)}
.chg-fixed{background:var(--edge-bg);color:var(--edge)}
.feature{border-top:1px solid var(--line);margin-top:10px}
.f-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-bottom:6px}
.f-head h2{flex:1 1 320px}
.f-head .pr{font-size:12.5px;color:var(--muted)}
.f-sum{margin:0 0 18px;max-width:760px;font-size:16px;color:var(--soft)}
.f-sub{margin:20px 0 10px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--muted)}
.cover{display:none}
.acts{display:flex;flex-wrap:wrap;gap:8px}
.exp{border:1px solid var(--btn);background:var(--paper);color:var(--btn);border-radius:8px;padding:9px 18px;font-weight:600;font-size:14.5px}
.exp:disabled{border-color:var(--line);color:var(--muted);cursor:not-allowed}
`;

const HIDDEN_IN_EXPORT = ['header', 'footer', '.bar', '.modal', '.legend', '.cacts', '.cbox', '.cview', '.confirm', '.ev', '.j-foot', '.r-foot', '.f-head .pr', '[data-group="questions"]', '.rejected'];

const PRINT_CSS = `
@page{size:A4;margin:18mm 16mm 20mm;@bottom-right{content:counter(page);font:9pt sans-serif;color:#656d76}}
@page:first{@bottom-right{content:none}}
@media print{
:root:root:root{color-scheme:light;${LIGHT_VARS}}
html,body{background:#fff}
body{-webkit-print-color-adjust:exact;print-color-adjust:exact;font-size:11pt}
body.exporting .wrap{max-width:none;padding:0}
body.exporting ${HIDDEN_IN_EXPORT.join(',body.exporting ')}{display:none!important}
body.exporting .cover{display:block;break-after:page;padding-top:60mm}
body.exporting .cover img{max-height:28mm;max-width:70mm;margin-bottom:12mm}
body.exporting .cover .co-product{font-size:13pt;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
body.exporting .cover h1{font-size:34pt;margin:4mm 0 3mm}
body.exporting .cover .co-meta{font-size:12pt;color:var(--muted);margin-bottom:10mm}
body.exporting .cover .summary{font-size:14pt;max-width:none}
body.exporting .cover .co-counts{margin-top:10mm;font-size:11pt;color:var(--soft)}
body.exporting section.feature{margin:0 0 10mm;padding:8mm 0 0;border:0;border-top:1px solid var(--line)}
body.exporting section.feature:first-of-type{border-top:0;padding-top:0}
body.exporting .f-head,body.exporting .f-sum,body.exporting .f-sub{break-after:avoid}
body.exporting .card,body.exporting .f-sum{break-inside:avoid}
body.exporting .card.guess{border:1px solid var(--line);background:var(--paper)}
body.exporting .rules,body.exporting .data{grid-template-columns:1fr}
body.exporting .journey{margin-bottom:12px}
}
`;

/** The business page's styles plus the release map's: sections, badges, the export button and the printed view. */
export const RELEASE_CSS = BUSINESS_CSS + SCREEN_CSS + PRINT_CSS;
