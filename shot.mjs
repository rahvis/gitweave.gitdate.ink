import { chromium } from 'playwright';
const [out, w, h, url] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2, isMobile: +w < 500, hasTouch: +w < 500 });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(url || 'http://localhost:3000/', { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(2500);
const m = await p.evaluate(() => {
  const head = document.querySelector('.gw-panel__head');
  const hdr = document.querySelector('.cds--header');
  const firstRank = document.querySelector('.gw-rank');
  const r = el => el ? el.getBoundingClientRect() : null;
  const hb = r(hdr), pb = r(head), fb = r(firstRank);
  return {
    headerBottom: hb && Math.round(hb.bottom),
    panelHeadTop: pb && Math.round(pb.top),
    panelHeadVisible: pb ? pb.top >= (hb ? hb.bottom - 1 : 0) : false,
    firstRankTop: fb && Math.round(fb.top),
    docScrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
});
await p.screenshot({ path: out, fullPage: +w < 900 });
console.log(JSON.stringify({ viewport: `${w}x${h}`, ...m, errs: errs.slice(0,4) }, null, 1));
await b.close();
