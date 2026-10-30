// Browser QA against a served URL using puppeteer-core and a local Edge/Chrome.
// Usage: node scripts/qa_browser.mjs <baseUrl> <outDir> [label]
//   QA_NODE_MODULES=C:\p3qa\node_modules  (where puppeteer-core is installed; NOT needed for deployment)
//   QA_BROWSER="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(path.join(process.env.QA_NODE_MODULES || 'C:\\p3qa\\node_modules', 'x.js'));
const puppeteer = require('puppeteer-core');

const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const outDir = path.resolve(process.argv[3] || 'screenshots');
const label = process.argv[4] || 'local';
const exe = process.env.QA_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
fs.mkdirSync(outDir, { recursive: true });

const pages = [
  ['home', '/'], ['start-here', '/start-here/'], ['guides', '/guides/'], ['category-daily-resets', '/category/daily-resets/'],
  ['article-001', '/guides/small-apartment-cleaning-schedule/'], ['printables', '/printables/'], ['about', '/about/'], ['contact', '/contact/'],
  ['editorial-policy', '/editorial-policy/'], ['privacy-policy', '/privacy-policy/'], ['search', '/search/?q=bathroom'], ['404', '/this-page-does-not-exist/']
];
const viewports = [['360', 360, 740], ['390', 390, 844], ['768', 768, 1024], ['1024', 1024, 768], ['1440', 1440, 900]];
const results = []; const log = [];
const rec = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); };

const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });
const consoleErrors = []; const failedRequests = [];
async function newPage(w, h) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700 });
  page.on('console', (m) => { const deliberate404 = /does-not-exist|not-a-real-guide/.test(page.url()) && /Failed to load resource/.test(m.text()); if (['error', 'warning'].includes(m.type()) && !deliberate404) consoleErrors.push(`${page.url()} [${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => consoleErrors.push(`${page.url()} [pageerror] ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/does-not-exist|not-a-real-guide/.test(r.url())) failedRequests.push(`${r.status()} ${r.url()}`); });
  return page;
}

// 1) every page at every viewport: status, overflow, screenshot
const overflow = []; const statuses = [];
for (const [vn, w, h] of viewports) {
  const page = await newPage(w, h);
  for (const [name, p] of pages) {
    const resp = await page.goto(base + p, { waitUntil: 'networkidle0', timeout: 30000 });
    const expected = name === '404' ? 404 : 200;
    if (resp.status() !== expected) statuses.push(`${p} ${resp.status()} (expected ${expected}) @${vn}`);
    const m = await page.evaluate(() => {
      const de = document.documentElement; const bad = [];
      document.querySelectorAll('body *').forEach((el) => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.right > de.clientWidth + 1 && !el.closest('.table-wrap') && getComputedStyle(el).position !== 'fixed' && !el.closest('.skip-link')) bad.push(el.tagName.toLowerCase() + '.' + (el.className || '').toString().slice(0, 30)); });
      return { sw: de.scrollWidth, cw: de.clientWidth, bad: bad.slice(0, 3) };
    });
    if (m.sw > m.cw + 1) overflow.push(`${p} @${vn}: scrollWidth ${m.sw} > ${m.cw} (${m.bad.join(', ')})`);
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } window.scrollTo(0, 0); });
    await new Promise((r) => setTimeout(r, 200));
    if (['home', 'article-001', 'printables', '404', 'guides'].includes(name) || vn === '360') await page.screenshot({ path: path.join(outDir, `${label}_${name}_${vn}.png`), fullPage: true });
  }
  await page.close();
}
rec('all 12 pages return the expected HTTP status at all 5 viewport widths', statuses.length === 0, statuses.slice(0, 4).join(' | '));
rec('no horizontal overflow at 360, 390, 768, 1024 and 1440 px (tables scroll inside their own wrapper)', overflow.length === 0, overflow.slice(0, 4).join(' | '));

// 2) mobile navigation
{
  const page = await newPage(390, 844); await page.goto(base + '/', { waitUntil: 'networkidle0' });
  const hiddenBefore = await page.evaluate(() => getComputedStyle(document.getElementById('site-nav')).display === 'none');
  await page.click('.nav-toggle');
  const open = await page.evaluate(() => ({ disp: getComputedStyle(document.getElementById('site-nav')).display, exp: document.querySelector('.nav-toggle').getAttribute('aria-expanded') }));
  await page.keyboard.press('Escape');
  const after = await page.evaluate(() => ({ disp: getComputedStyle(document.getElementById('site-nav')).display, exp: document.querySelector('.nav-toggle').getAttribute('aria-expanded'), focus: document.activeElement.className }));
  rec('mobile menu: closed by default, opens with the button, aria-expanded updates, Escape closes and returns focus', hiddenBefore && open.disp !== 'none' && open.exp === 'true' && after.disp === 'none' && after.exp === 'false' && /nav-toggle/.test(after.focus), JSON.stringify({ hiddenBefore, open, after }));
  await page.setViewport({ width: 360, height: 740 }); await page.goto(base + '/', { waitUntil: 'networkidle0' }); await page.click('.nav-toggle');
  await page.screenshot({ path: path.join(outDir, `${label}_mobile-menu-open_360.png`) });
  await page.close();
}
// 3) no-JS fallback: nav visible
{
  const page = await browser.newPage(); await page.setJavaScriptEnabled(false); await page.setViewport({ width: 360, height: 740 });
  await page.goto(base + '/', { waitUntil: 'load' });
  const vis = await page.evaluate(() => { const n = document.getElementById('site-nav'); return getComputedStyle(n).display !== 'none' && n.querySelectorAll('a').length >= 4; });
  const art = await page.goto(base + '/guides/small-apartment-cleaning-schedule/', { waitUntil: 'load' });
  const hasText = await page.evaluate(() => document.getElementById('article-body').innerText.length > 5000);
  rec('without JavaScript: navigation links stay visible and the article text is present', vis && hasText, `navVisible=${vis} articleText=${hasText}`);
  await page.close();
}
// 4) keyboard: skip link and focus visibility
{
  const page = await newPage(1024, 768); await page.goto(base + '/guides/small-apartment-cleaning-schedule/', { waitUntil: 'networkidle0' });
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); const cs = getComputedStyle(a); return { cls: a.className, left: r.left, outline: cs.outlineStyle + ' ' + cs.outlineWidth }; });
  await page.keyboard.press('Enter');
  const target = await page.evaluate(() => document.activeElement.id || document.activeElement.tagName);
  let seen = 0, noOutline = [];
  for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); const o = await page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { t: a.tagName + '.' + (a.className || '').toString().slice(0, 20), ow: parseFloat(cs.outlineWidth), os: cs.outlineStyle }; }); seen++; if (o.os === 'none' || o.ow < 2) noOutline.push(o.t); }
  rec('keyboard: first Tab reaches the skip link, Enter moves focus to main, 25 further tab stops all show a visible focus outline', first.cls === 'skip-link' && first.left >= 0 && target === 'main' && noOutline.length === 0, `first=${JSON.stringify(first)} target=${target} withoutOutline=${noOutline.join(',')}`);
  await page.close();
}
// 5) article: toc anchors, printable download, table overflow, headings
{
  const page = await newPage(1440, 900); await page.goto(base + '/guides/small-apartment-cleaning-schedule/', { waitUntil: 'networkidle0' });
  const info = await page.evaluate(() => ({
    toc: document.querySelectorAll('.toc a').length, h1: document.querySelectorAll('h1').length,
    cta: !!document.querySelector('.printable-cta a[href$=".pdf"]'), pdfHref: document.querySelector('.printable-cta a')?.getAttribute('href'),
    tables: document.querySelectorAll('.table-wrap table').length, safety: !!document.querySelector('.callout-safety'),
    sourceLinks: [...document.querySelectorAll('.callout-safety a')].map((a) => a.href).filter((h) => /poison\.org|cdc\.gov|epa\.gov/.test(h)).length,
    tocOpen: document.querySelector('details.toc')?.open
  }));
  rec('article: table of contents, one h1, printable CTA, responsive tables and a sourced safety callout all render', info.toc >= 6 && info.h1 === 1 && info.cta && info.tables >= 3 && info.safety && info.sourceLinks >= 4, JSON.stringify(info));
  const pdfResp = await page.goto(new URL(info.pdfHref, page.url()).href);
  rec('article printable link opens a real PDF', pdfResp.status() === 200 && /pdf/.test(pdfResp.headers()['content-type'] || ''), `${pdfResp.status()} ${pdfResp.headers()['content-type']}`);
  await page.goto(base + '/guides/small-apartment-cleaning-schedule/', { waitUntil: 'networkidle0' });
  await page.click('.toc a:nth-child(1)').catch(() => {});
  const firstToc = await page.$eval('.toc li a', (a) => a.getAttribute('href'));
  await page.click('.toc li a');
  const hash = await page.evaluate(() => location.hash);
  rec('article: table-of-contents link jumps to its section', hash === firstToc, `${firstToc} -> ${hash}`);
  await page.close();
}
// 6) printables page downloads
{
  const page = await newPage(1024, 768); await page.goto(base + '/printables/', { waitUntil: 'networkidle0' });
  const links = await page.$$eval('a[href$=".pdf"]', (as) => as.map((a) => a.href));
  const stat = []; for (const l of links) { const r = await page.evaluate(async (u) => { const x = await fetch(u); const b = new Uint8Array((await x.arrayBuffer()).slice(0, 5)); return { s: x.status, ct: x.headers.get('content-type'), sig: String.fromCharCode(...b) }; }, l); stat.push(r); }
  rec('printables page: every PDF link returns 200, application/pdf and a %PDF header', links.length === 4 && stat.every((r) => r.s === 200 && /pdf/.test(r.ct) && r.sig.startsWith('%PDF')), `${links.length} links; ${stat.map((r) => r.s + ':' + r.sig).join(', ')}`);
  const imgs = await page.$$eval('img', (is) => is.every((i) => i.complete && i.naturalWidth > 0));
  rec('printables page: all preview images load', imgs);
  await page.close();
}
// 7) search
{
  const page = await newPage(1024, 768); await page.goto(base + '/search/', { waitUntil: 'networkidle0' });
  await page.type('#q', 'bathroom'); await new Promise((r) => setTimeout(r, 300));
  const hit = await page.$$eval('#results li', (l) => l.map((x) => x.querySelector('a').getAttribute('href')));
  await page.click('#q', { clickCount: 3 }); await page.type('#q', 'zzzzqqq'); await new Promise((r) => setTimeout(r, 300));
  const none = await page.$eval('#results-status', (e) => e.textContent);
  await page.goto(base + '/search/?q=printable', { waitUntil: 'networkidle0' }); await new Promise((r) => setTimeout(r, 300));
  const q = await page.$eval('#q', (e) => e.value);
  const n = await page.$$eval('#results li', (l) => l.length);
  rec('search: finds the article, shows an honest empty state, reads ?q= from the URL', hit.some((h) => h.includes('small-apartment-cleaning-schedule')) && /No results/.test(none) && q === 'printable' && n >= 1, `hits=${hit.join(',')} empty="${none}" q=${q} n=${n}`);
  const link = await page.$eval('#results a', (a) => a.href); const r2 = await page.goto(link); rec('search: a result link opens a real page', r2.status() === 200, link);
  await page.close();
}
// 8) guides filter
{
  const page = await newPage(1024, 768); await page.goto(base + '/guides/', { waitUntil: 'networkidle0' });
  await page.click('button[data-filter="safe-cleaning"]');
  const st = await page.evaluate(() => ({ shown: [...document.querySelectorAll('[data-category]')].filter((e) => e.tagName === 'LI' && !e.hidden).length, msg: document.getElementById('filter-status').textContent, pressed: document.querySelector('button[data-filter="safe-cleaning"]').getAttribute('aria-pressed') }));
  await page.click('button[data-filter="all"]');
  const back = await page.evaluate(() => [...document.querySelectorAll('li[data-category]')].filter((e) => !e.hidden).length);
  rec('guides filter: empty topic shows a message, All restores the list, aria-pressed updates', st.shown === 0 && /No guides/.test(st.msg) && st.pressed === 'true' && back >= 1, JSON.stringify({ st, back }));
  await page.close();
}
// 9) print styles
{
  const page = await newPage(1024, 768); await page.goto(base + '/guides/small-apartment-cleaning-schedule/', { waitUntil: 'networkidle0' });
  await page.emulateMediaType('print');
  const p = await page.evaluate(() => ({ header: getComputedStyle(document.querySelector('.site-header')).display, footer: getComputedStyle(document.querySelector('.site-footer')).display, toc: getComputedStyle(document.querySelector('.toc')).display, banner: document.querySelector('.preview-banner') ? getComputedStyle(document.querySelector('.preview-banner')).display : 'none' }));
  rec('print styles hide header, footer, table of contents and preview banner', p.header === 'none' && p.footer === 'none' && p.toc === 'none' && p.banner === 'none', JSON.stringify(p));
  await page.pdf({ path: path.join(outDir, `${label}_article-print.pdf`), format: 'Letter', printBackground: false });
  await page.close();
}
// 10) metadata seen by the browser, sitemap and robots over HTTP
{
  const page = await newPage(1024, 768);
  const sm = await page.goto(base + '/sitemap.xml'); const rb = await page.goto(base + '/robots.txt'); const mf = await page.goto(base + '/site.webmanifest'); const fd = await page.goto(base + '/feed.xml');
  rec('sitemap.xml, robots.txt, site.webmanifest and feed.xml are served with HTTP 200', [sm, rb, mf, fd].every((r) => r.status() === 200), [sm, rb, mf, fd].map((r) => r.status()).join(','));
  const r404 = await page.goto(base + '/guides/not-a-real-guide/'); rec('unknown deep URL returns HTTP 404 with the custom 404 page', r404.status() === 404 && (await page.title()).includes('Page not found'), `${r404.status()} ${await page.title()}`);
  const css404 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor); rec('custom 404 page keeps its styles on a deep URL', css404 === 'rgb(246, 241, 231)', css404);
  await page.close();
}
// 11) console and network
rec('no JavaScript console errors or warnings on any visited page', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '));
rec('no failed network requests (status 400 or higher) apart from the deliberate 404 test', failedRequests.length === 0, failedRequests.slice(0, 4).join(' | '));
// 12) reduced motion
{
  const page = await newPage(1024, 768); await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]); await page.goto(base + '/', { waitUntil: 'networkidle0' });
  const t = await page.evaluate(() => getComputedStyle(document.querySelector('.btn')).transitionDuration);
  rec('prefers-reduced-motion: reduce disables transitions', /^0s/.test(t), t); await page.close();
}
// 13) timing from the browser (informational)
{
  const page = await newPage(390, 844); await page.goto(base + '/guides/small-apartment-cleaning-schedule/', { waitUntil: 'networkidle0' });
  const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; const res = performance.getEntriesByType('resource'); return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), transferKB: Math.round(res.reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0) / 1024), requests: res.length }; });
  console.log('INFO  article @390 local timings (not a Lighthouse score):', JSON.stringify(nav)); log.push(nav); await page.close();
}
await browser.close();
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(outDir, `${label}_browser_results.json`), JSON.stringify({ ran_utc: new Date().toISOString(), base, browser: exe.split('\\').pop(), total: results.length, failed: failed.length, results, timings: log }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed against ${base}`);
process.exit(failed.length ? 1 : 0);


