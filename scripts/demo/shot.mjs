// node shot.mjs <page.html> <out.png> <width> <height> <light|dark> [click-node-id]
import { chromium } from 'playwright';

const [html, out, w, h, scheme, clickId] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: 2,
  colorScheme: scheme === 'light' ? 'light' : 'dark',
});
await page.goto(`file://${html}`);
await page.waitForSelector('.node');
await page.waitForTimeout(700);
if (clickId) {
  const box = await page.locator(`.node[data-id="${clickId}"]`).first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(700);
}
await page.screenshot({ path: out });
await browser.close();
