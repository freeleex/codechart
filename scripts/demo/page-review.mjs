// node page-review.mjs <map.html> <out dir> <message file> [short]: records the page scene of docs/images/page-review-full.gif
// (or, with "short", of page-review.gif: two notes, no node note) and saves the text "Finish review" copied. Needs playwright, installed outside the repo (see record-page-review.sh).
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [html, out, messageFile, mode] = process.argv.slice(2);
const short = mode === 'short';
const size = { width: 1180, height: 620 };
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: size,
  deviceScaleFactor: 1,
  colorScheme: 'dark',
  permissions: ['clipboard-read', 'clipboard-write'],
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
    'background:rgba(255,255,255,.85);box-shadow:0 0 0 3px rgba(0,0,0,.35);transition:left .45s ease,top .6s ease,transform .15s';
  document.body.append(c);
});
const moveTo = async (selector, dx = 0) => {
  const loc = page.locator(selector).first();
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  const x = box.x + Math.min(box.width / 2, 60) + dx;
  const y = box.y + Math.min(box.height / 2, 14);
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
const note = async (kind, text) => {
  await page.waitForSelector('.cm-composer textarea');
  await page.keyboard.type(text, { delay: 24 });
  if (kind !== 'comment') {
    await click(`.cm-composer .cm-kind-btn.cm-k-${kind}`);
  }
  await page.waitForTimeout(500);
  await click('.cm-composer .cm-save');
  await page.waitForTimeout(400);
};

await page.waitForTimeout(600);
await click('.node[data-id="tbl.orders"]');
await page.waitForTimeout(500);
await click('.hunk.folded:has-text("class Order") .hunk-sum');
await page.waitForTimeout(400);

// Hover shows the + on the line number; the click opens the note box.
await click('.hunk:not(.folded) .dr.d-add:has-text("default=OrderStatus") .ln', 450);
await note('comment', 'default needs a data migration for old rows');

await click('.hunk:not(.folded) .dr.d-del:has-text("status = Column") .ln', 500);
await note('delete', 'drop this line, keep the old column');

if (!short) {
  await click('#panel .cm-node-btn');
  await note('question', 'should coupon_code be indexed?');
}

await moveTo('#finish-review');
await page.waitForTimeout(500);
await click('#finish-review');
await page.waitForSelector('#finish-dialog');
await page.waitForTimeout(short ? 1500 : 2200);
await click('#finish-dialog .cm-copy');
await page.waitForTimeout(short ? 1500 : 1300);

writeFileSync(messageFile, await page.evaluate(() => navigator.clipboard.readText()));
await context.close();
await browser.close();
