// node shot.mjs <page.html> <out.png> <width> <height> <light|dark> [click-node-id [tab]]
// tab: a tab of the page's view row (e.g. flows), opened before the click; `side` turns Side by side on and keeps the highlight
import { chromium } from 'playwright';

const [html, out, w, h, scheme, clickId, tab] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: 2,
  colorScheme: scheme === 'light' ? 'light' : 'dark',
});
await page.goto(`file://${html}`);
await page.waitForSelector('.node');
await page.waitForTimeout(700);
if (tab) {
  await page.click(tab === 'side' ? '#sbs' : `#view-tabs [data-tab="${tab}"]`);
  await page.waitForTimeout(400);
}
if (clickId) {
  const box = await page.locator(`.node[data-id="${clickId}"]`).first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // Esc undims the rest but keeps the panel open, so the whole map stays readable; side by side is shown lit
  if (tab !== 'side') await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
}
await page.screenshot({ path: out });
await browser.close();
