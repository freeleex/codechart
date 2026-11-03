// node page.mjs <map.html> <out dir>: records the full-map page scene of the demo GIF.
// Needs playwright, installed outside the repo (see record.sh).
import { chromium } from 'playwright';

const [html, out] = process.argv.slice(2);
const size = { width: 1180, height: 620 };
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: size,
  deviceScaleFactor: 1,
  colorScheme: 'dark',
  recordVideo: { dir: out, size },
});
const page = await context.newPage();
await page.goto(`file://${html}`);
await page.waitForSelector('.node[data-id="tbl.orders"]');

// Headless video has no pointer, so draw one.
await page.evaluate(() => {
  const c = document.createElement('div');
  c.id = 'demo-cursor';
  c.style.cssText =
    'position:fixed;left:600px;top:560px;width:18px;height:18px;border-radius:50%;z-index:99999;pointer-events:none;' +
    'background:rgba(255,255,255,.85);box-shadow:0 0 0 3px rgba(0,0,0,.35);transition:left .7s ease,top .7s ease,transform .15s';
  document.body.append(c);
});
const click = async (selector) => {
  const box = await page.locator(selector).boundingBox();
  const x = box.x + Math.min(box.width / 2, 60);
  const y = box.y + 14;
  await page.evaluate(([x, y]) => {
    const c = document.getElementById('demo-cursor');
    c.style.left = `${x - 9}px`;
    c.style.top = `${y - 9}px`;
  }, [x, y]);
  await page.waitForTimeout(800);
  await page.evaluate(() => (document.getElementById('demo-cursor').style.transform = 'scale(.7)'));
  await page.mouse.click(x, y);
  await page.evaluate(() => setTimeout(() => (document.getElementById('demo-cursor').style.transform = ''), 150));
};

await page.waitForTimeout(1200);
await click('.node[data-id="tbl.orders"]');
await page.waitForTimeout(2600);
await page.evaluate(() => (document.getElementById('demo-cursor').style.display = 'none'));
await page.screenshot({ path: `${out}/shot.png` });
await page.evaluate(() => (document.getElementById('demo-cursor').style.display = ''));
await click('.node[data-id="api.refund"]');
await page.waitForTimeout(3000);

await context.close();
await browser.close();
