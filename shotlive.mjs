import { chromium } from 'playwright';
const [out, w, h, tab] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2, isMobile: +w < 500, hasTouch: +w < 500 });
const errs = []; p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const t0 = Date.now();
await p.goto('https://gitweave.gitdate.ink/', { waitUntil: 'networkidle', timeout: 60000 });
const load = Date.now() - t0;
await p.waitForTimeout(1500);
if (tab) { await p.getByRole('tab', { name: new RegExp(tab, 'i') }).click(); await p.waitForTimeout(900); }
const m = await p.evaluate(() => ({
  scrollH: document.documentElement.scrollHeight, clientH: document.documentElement.clientHeight,
  hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  ranks: document.querySelectorAll('.gw-rank').length,
  cutRows: document.querySelectorAll('.gw-cut__row').length,
  strips: document.querySelectorAll('.gw-strip').length,
  finding: document.querySelector('.gw-insight__text')?.textContent?.trim().slice(0,160),
}));
await p.screenshot({ path: out, fullPage: +w < 900 });
console.log(JSON.stringify({ vp:`${w}x${h}`, loadMs: load, ...m, errs: errs.slice(0,3) }, null, 1));
await b.close();
