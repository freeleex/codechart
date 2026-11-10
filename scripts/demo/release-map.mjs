// node release-map.mjs <release.html> <out dir>: screenshots the page at a few scroll positions, in order, for the GIF
// (see record-feature.sh). Stills rather than a video: a recorded scroll of a long page tears.
import { chromium } from 'playwright';

const [html, out] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 620 }, deviceScaleFactor: 1 });
await page.goto(`file://${html}`);
await page.waitForSelector('.cover');
const features = await page.$$eval('.feature', (els) => els.map((e) => e.offsetTop));
const views = [170, features[0] - 24, features[0] + 330, features[1] - 24, features.at(-1) - 24];
for (const [i, y] of views.entries()) {
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.screenshot({ path: `${out}/${i}.png` });
}
await browser.close();
