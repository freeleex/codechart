// Shared by flow.mjs and plan-vs-built.mjs: a recorded page with a drawn pointer. Needs playwright (see record-feature.sh).
import { chromium } from 'playwright';

export async function openPage(html, out, ready, size = { width: 1040, height: 600 }) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, colorScheme: 'dark', recordVideo: { dir: out, size } });
  const page = await context.newPage();
  await page.goto(`file://${html}`);
  await page.waitForSelector(ready);

  // Headless video has no pointer, so draw one.
  await page.evaluate(() => {
    const c = document.createElement('div');
    c.id = 'demo-cursor';
    c.style.cssText =
      'position:fixed;left:520px;top:540px;width:18px;height:18px;border-radius:50%;z-index:99999;pointer-events:none;' +
      'background:rgba(255,255,255,.85);box-shadow:0 0 0 3px rgba(0,0,0,.35);transition:left .45s ease,top .6s ease,transform .15s';
    document.body.append(c);
  });
  const moveTo = async (selector) => {
    const loc = page.locator(selector).first();
    await loc.scrollIntoViewIfNeeded();
    const box = await loc.boundingBox();
    const onMap = selector.startsWith('.node');
    const x = box.x + (onMap ? box.width / 2 : Math.min(box.width / 2, 60));
    const y = box.y + (onMap ? box.height / 2 : Math.min(box.height / 2, 14));
    await page.evaluate(([x, y]) => {
      const c = document.getElementById('demo-cursor');
      c.style.left = `${x - 9}px`;
      c.style.top = `${y - 9}px`;
    }, [x, y]);
    await page.mouse.move(x, y, { steps: 8 });
    await page.waitForTimeout(450);
    return [x, y];
  };
  const click = async (selector, hover = 0) => {
    const [x, y] = await moveTo(selector);
    await page.waitForTimeout(hover);
    await page.evaluate(() => (document.getElementById('demo-cursor').style.transform = 'scale(.7)'));
    await page.mouse.click(x, y);
    await page.evaluate(() => setTimeout(() => (document.getElementById('demo-cursor').style.transform = ''), 150));
  };
  const finish = async () => {
    await context.close();
    await browser.close();
  };
  return { page, moveTo, click, finish };
}
