// node plan-vs-built.mjs <summary.html> <out dir>: records docs/images/plan-vs-built.gif (see record-feature.sh).
import { openPage } from './feature-lib.mjs';

const [html, out] = process.argv.slice(2);
const { page, click, finish } = await openPage(html, out, '.node[data-id="tbl.orders"]');

await page.waitForTimeout(1200);
await click('.node[data-id="tbl.orders"]');
await page.waitForTimeout(1000);
await click('header button.check.warn');
await page.waitForTimeout(2000);
await click('#page-info [data-goto="api.refund"]');
await page.waitForTimeout(1300);
await click('#panel .drift-chip', 300);
await page.waitForTimeout(2600);
await click('header button.check.warn');
await page.waitForTimeout(700);
await click('#page-info [data-goto="svc.audit"]');
await page.waitForTimeout(2400);
await finish();
