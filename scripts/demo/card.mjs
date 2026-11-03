// node card.mjs <card.html> <logo.svg> <map screenshot> <out.png>
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [card, logo, shot, out] = process.argv.slice(2);
const html = readFileSync(card, 'utf8').replace('LOGO', `file://${logo}`).replace('SHOT', `file://${shot}`);
const tmp = `${out}.html`;
writeFileSync(tmp, html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
await page.goto(`file://${tmp}`);
await page.screenshot({ path: out });
await browser.close();
