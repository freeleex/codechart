// node flow.mjs <flow.html> <out dir>: records docs/images/flow.gif (see record-feature.sh).
import { openPage } from './feature-lib.mjs';

const [html, out] = process.argv.slice(2);
const { page, click, finish } = await openPage(html, out, '.node[data-id="flag"]');

await page.waitForTimeout(1500);
await click('.node[data-id="flag"]');
await page.waitForTimeout(3200);
await click('.node[data-id="paid"]');
await page.waitForTimeout(3200);
await finish();
