// node release-map.mjs <release.html> <out dir>: records docs/images/release-map.gif (see record-feature.sh).
import { openPage } from './feature-lib.mjs';

const [html, out] = process.argv.slice(2);
const { page, click, finish } = await openPage(html, out, '#export');

// Headless print has no dialog, so the click only stubs window.print and the print view is shown by hand.
await page.evaluate(() => (window.print = () => {}));
await page.waitForTimeout(1500);
await page.locator('.yes').first().scrollIntoViewIfNeeded();
await page.waitForTimeout(1200);
await click('.yes >> nth=0', 400);
await page.waitForTimeout(900);
await click('.no >> nth=1', 400);
await page.waitForTimeout(1000);
await click('#export', 600);
await page.evaluate(() => document.getElementById('demo-cursor').remove());
await page.emulateMedia({ media: 'print' });
await page.addStyleTag({
  content:
    'html,body.exporting{background:#e5e7eb!important}body.exporting .wrap:has(.cover){background:#fff;max-width:880px;margin:24px auto;padding:40px 48px;box-shadow:0 1px 4px rgba(0,0,0,.15)}',
});
await page.evaluate(() => document.body.classList.add('exporting'));
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1500);
// Smooth scrolling tears frames in headless video, so jump instead.
for (const y of [300, 620]) {
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.waitForTimeout(1500);
}
await finish();
