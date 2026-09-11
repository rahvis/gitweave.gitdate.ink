import { chromium } from 'playwright';
const [out, w, h, tab] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2, isMobile: +w < 500, hasTouch: +w < 500 });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(1500);
if (tab === 'strips') { await p.getByRole('tab', { name: /Cohort distribution/i }).click(); await p.waitForTimeout(900); }
const m = await p.evaluate(() => ({
  scrollH: document.documentElement.scrollHeight,
  clientH: document.documentElement.clientHeight,
  hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  ranksVisible: [...document.querySelectorAll('.gw-rank')].filter(e => {
    const r = e.getBoundingClientRect(); return r.bottom <= window.innerHeight + 1;
  }).length,
  totalRanks: document.querySelectorAll('.gw-rank').length,
  strips: document.querySelectorAll('.gw-strip').length,
  cutRows: document.querySelectorAll('.gw-cut__row').length,
}));
await p.screenshot({ path: out, fullPage: +w < 900 });
console.log(JSON.stringify({ vp: `${w}x${h}`, tab: tab || 'cut', ...m, errs: errs.slice(0,3) }));
await b.close();
