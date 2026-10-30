// Offline tests of the built folder plus content-system tests. Usage: node scripts/test.mjs [dist]
// Node only. Browser-based checks live in qa_browser.mjs (needs puppeteer-core and Edge or Chrome).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT } from './content.mjs';

const dist = path.resolve(ROOT, process.argv[2] || 'dist');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); };

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(dist);
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const rel = (f) => path.relative(dist, f).replace(/\\/g, '/');

// ---- helpers ----
function resolveLink(fromFile, href) {
  const [p0, hash] = href.split('#');
  const p = p0.split('?')[0];
  let target;
  if (p.startsWith('/')) target = path.join(dist, p);
  else if (p === '') target = fromFile;
  else target = path.resolve(path.dirname(fromFile), p);
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  return { target, hash };
}
const attrs = (html, tag, attr) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*?\\s${attr}="([^"]*)"`, 'gi'))].map((m) => m[1]);

// ---- 1. links, assets, anchors ----
const ids = (f) => new Set([...fs.readFileSync(f, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
let brokenLinks = [], brokenAssets = [], brokenAnchors = [];
for (const f of htmlFiles) {
  const html = fs.readFileSync(f, 'utf8');
  for (const href of attrs(html, 'a', 'href')) {
    if (/^(https?:|mailto:|tel:|javascript:)/.test(href)) continue;
    const { target, hash } = resolveLink(f, href);
    if (!fs.existsSync(target)) { brokenLinks.push(`${rel(f)} -> ${href}`); continue; }
    if (hash && target.endsWith('.html') && !ids(target).has(hash)) brokenAnchors.push(`${rel(f)} -> ${href}`);
  }
  const srcs = [...attrs(html, 'img', 'src'), ...attrs(html, 'script', 'src'), ...[...html.matchAll(/<link\b[^>]*?\shref="([^"]*)"/gi)].map((m) => m[1])];
  for (const s of srcs) {
    if (/^(https?:|data:)/.test(s)) continue;
    const { target } = resolveLink(f, s);
    if (!fs.existsSync(target)) brokenAssets.push(`${rel(f)} -> ${s}`);
  }
}
check('every internal link resolves to a built file', brokenLinks.length === 0, `${htmlFiles.length} HTML files; broken: ${brokenLinks.slice(0, 5).join(' | ')}`);
check('every image, script, stylesheet and icon path resolves', brokenAssets.length === 0, brokenAssets.slice(0, 5).join(' | '));
check('every #anchor link points to an existing id', brokenAnchors.length === 0, brokenAnchors.slice(0, 5).join(' | '));

// ---- 2. per-page metadata and structure ----
const problems = [];
const pageInfo = [];
for (const f of htmlFiles) {
  const html = fs.readFileSync(f, 'utf8');
  const r = rel(f);
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1];
  const canon = (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
  const robots = (html.match(/<meta name="robots" content="([^"]*)"/) || [])[1];
  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  if (!title) problems.push(`${r}: no <title>`);
  if (!desc) problems.push(`${r}: no meta description`);
  if (!canon) problems.push(`${r}: no canonical`);
  if (h1 !== 1) problems.push(`${r}: ${h1} h1 elements`);
  if (!/<html lang="/.test(html)) problems.push(`${r}: no html lang`);
  if (!/name="viewport"/.test(html)) problems.push(`${r}: no viewport`);
  if (!/<main id="main"/.test(html)) problems.push(`${r}: no main landmark`);
  if (!/class="skip-link"/.test(html)) problems.push(`${r}: no skip link`);
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    const tag = m[0];
    if (!/\salt="/.test(tag)) problems.push(`${r}: image without alt`);
    if (!/\swidth="\d+"/.test(tag) || !/\sheight="\d+"/.test(tag)) problems.push(`${r}: image without width/height`);
  }
  // heading order: no skipped levels downward
  const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
  for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) { problems.push(`${r}: heading level jumps h${levels[i - 1]} to h${levels[i]}`); break; }
  // JSON-LD parses
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) { try { JSON.parse(m[1]); } catch { problems.push(`${r}: invalid JSON-LD`); } }
  // first-load content exists without JS
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (text.length < 400 && r !== '404.html') problems.push(`${r}: very little text (${text.length} chars)`);
  pageInfo.push({ r, title, desc, canon, robots });
}
check('every page has title, description, canonical, one h1, lang, viewport, main landmark, skip link', problems.filter((p) => !/image|heading level|JSON-LD|little text/.test(p)).length === 0, problems.filter((p) => !/image|heading level|JSON-LD|little text/.test(p)).slice(0, 5).join(' | '));
check('every image has alt text and width/height', !problems.some((p) => /image/.test(p)), problems.filter((p) => /image/.test(p)).slice(0, 5).join(' | '));
check('heading levels do not skip downward', !problems.some((p) => /heading level/.test(p)), problems.filter((p) => /heading level/.test(p)).join(' | '));
check('JSON-LD blocks parse', !problems.some((p) => /JSON-LD/.test(p)));
check('pages expose real text without JavaScript', !problems.some((p) => /little text/.test(p)));
const titles = pageInfo.map((p) => p.title); const dupT = titles.filter((t, i) => titles.indexOf(t) !== i);
check('page titles are unique', dupT.length === 0, dupT.join(' | '));
const descs = pageInfo.map((p) => p.desc); const dupD = descs.filter((t, i) => descs.indexOf(t) !== i);
check('meta descriptions are unique', dupD.length === 0, dupD.join(' | '));

// ---- 3. sitemap, robots, feed, drafts ----
const sitemap = fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
// The origin the build actually used (config value, or the hosting-provided address if the config still has the placeholder).
const builtSiteConfig = JSON.parse(fs.readFileSync(path.join(dist, 'site-config.js'), 'utf8').match(/SITE_CONFIG = (\{[\s\S]*?\});/)[1]);
const origin = builtSiteConfig.siteOrigin.replace(/\/$/, '');
const missingFromDisk = locs.filter((l) => !fs.existsSync(path.join(dist, l.replace(origin, ''), 'index.html')) && !fs.existsSync(path.join(dist, l.replace(origin, ''))));
check('every sitemap URL exists in the build', missingFromDisk.length === 0, `${locs.length} URLs; missing: ${missingFromDisk.join(' | ')}`);
// Two build modes are tested: PREVIEW (previewMode true: every page noindex) and LAUNCH (node scripts/build.mjs --launch).
const previewBuilt = /"previewMode":\s*true/.test(fs.readFileSync(path.join(dist, 'site-config.js'), 'utf8'));
console.log(`Testing a ${previewBuilt ? 'PREVIEW' : 'LAUNCH'} build: ${path.basename(dist)}`);
if (previewBuilt) {
  check('PREVIEW BUILD: every page, including the 404, asks search engines not to index or follow it', pageInfo.every((p) => /noindex, nofollow|^noindex$/.test(p.robots || '')), pageInfo.filter((p) => !/noindex/.test(p.robots || '')).map((p) => p.r).join(' | '));
  check('PREVIEW BUILD: the preview banner on every page (except the 404) says every page asks search engines not to index it', htmlFiles.filter((f) => rel(f) !== '404.html').every((f) => /class="preview-banner"[^>]*>[^<]*every page asks search engines not to index it/.test(fs.readFileSync(f, 'utf8'))));
  check('PREVIEW BUILD: robots.txt keeps crawling allowed so crawlers can read the noindex tag, and flags the preview', /Allow: \//.test(fs.readFileSync(path.join(dist, 'robots.txt'), 'utf8')) && /PREVIEW BUILD/.test(fs.readFileSync(path.join(dist, 'robots.txt'), 'utf8')));
} else {
  check('LAUNCH BUILD: no preview banner and no "preview-build dates" note anywhere', !htmlFiles.some((f) => /class="preview-banner"|preview-build dates/.test(fs.readFileSync(f, 'utf8'))));
  check('LAUNCH BUILD: indexable pages say "index, follow" and the home page is one of them', pageInfo.some((p) => p.r === 'index.html' && /^index, follow/.test(p.robots || '')));
  const noindexInMap = pageInfo.filter((p) => /noindex/.test(p.robots || '') && locs.includes(p.canon));
  check('no noindex page is listed in the sitemap', noindexInMap.length === 0, noindexInMap.map((p) => p.r).join(' | '));
  const indexablePages = pageInfo.filter((p) => !/noindex/.test(p.robots || ''));
  check('every indexable page is in the sitemap', indexablePages.length > 0 && indexablePages.every((p) => locs.includes(p.canon)), indexablePages.filter((p) => !locs.includes(p.canon)).map((p) => p.r).join(' | '));
}
check('canonical URLs use the configured origin', pageInfo.every((p) => p.canon.startsWith(origin)), origin);
const robots = fs.readFileSync(path.join(dist, 'robots.txt'), 'utf8');
check('robots.txt allows crawling (a crawler must fetch a page to see its noindex tag) and names the sitemap', /Allow: \//.test(robots) && !/Disallow: \/\s*$/m.test(robots) && robots.includes(`${origin}/sitemap.xml`));
const feed = fs.readFileSync(path.join(dist, 'feed.xml'), 'utf8');
check('Atom feed has required elements', /<feed xmlns="http:\/\/www.w3.org\/2005\/Atom">/.test(feed) && /<id>/.test(feed) && /<updated>/.test(feed) && !/<entry>[\s\S]*<entry>[\s\S]*never-mix/.test(feed));
const draftSlugs = fs.readdirSync(path.join(ROOT, 'src/content/articles')).filter((f) => f.startsWith('_draft')).map((f) => fs.readFileSync(path.join(ROOT, 'src/content/articles', f), 'utf8').match(/^slug:\s*(.+)$/m)?.[1].trim()).filter(Boolean);
const leaks = [];
for (const s of draftSlugs) {
  if (fs.existsSync(path.join(dist, 'guides', s))) leaks.push(`page guides/${s}`);
  for (const f of ['sitemap.xml', 'feed.xml', 'search-index.json']) if (fs.readFileSync(path.join(dist, f), 'utf8').includes(s)) leaks.push(f);
  for (const h of htmlFiles) if (fs.readFileSync(h, 'utf8').includes(`/${s}/`) || fs.readFileSync(h, 'utf8').includes(`${s}/`)) leaks.push(rel(h));
}
check('draft articles are absent from pages, sitemap, feed, search index and navigation', leaks.length === 0 && draftSlugs.length > 0, `drafts checked: ${draftSlugs.join(', ')}; leaks: ${leaks.join(' | ')}`);
check('search index parses and lists the published article', (() => { const j = JSON.parse(fs.readFileSync(path.join(dist, 'search-index.json'), 'utf8')); return Array.isArray(j) && j.some((d) => d.url.startsWith('guides/')); })());
check('web manifest parses and its icons exist', (() => { const m = JSON.parse(fs.readFileSync(path.join(dist, 'site.webmanifest'), 'utf8')); return m.icons.every((i) => fs.existsSync(path.join(dist, i.src))); })());
check('no ad code, tracking script or form submission target ships by default', !htmlFiles.some((f) => /googlesyndication|adsbygoogle|googletagmanager|<form[^>]*action="https?:/.test(fs.readFileSync(f, 'utf8'))));
check('placeholders are limited to template pages', (() => { const bad = htmlFiles.filter((f) => /\[OWNER/.test(fs.readFileSync(f, 'utf8')) && !/about|editorial|privacy|terms|contact/.test(rel(f))); return bad.length === 0; })());
check('article page has no leftover shortcodes or placeholders', (() => { const f = files.find((x) => x.includes('small-apartment-cleaning-schedule') && x.endsWith('index.html')); const h = fs.readFileSync(f, 'utf8'); return !/\{\{|PRINTABLE_URL|\[OWNER|TODO/.test(h) && /Download the PDF/.test(h); })());

// ---- 4. contrast of design tokens (WCAG 2.x) ----
const css = fs.readFileSync(path.join(dist, 'assets/css/styles.css'), 'utf8');
const tok = (n) => css.match(new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`))[1];
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = [['ink', 'bg'], ['ink', 'surface'], ['ink-soft', 'bg'], ['ink-soft', 'surface'], ['accent-dark', 'bg'], ['accent-dark', 'surface'], ['accent-dark', 'sand'], ['ink-soft', 'sand']];
const low = pairs.map(([f, b]) => ({ f, b, r: ratio(tok(f), tok(b)) })).filter((x) => x.r < 4.5);
check('text colour pairs meet WCAG AA 4.5:1', low.length === 0, pairs.map(([f, b]) => `${f}/${b}=${ratio(tok(f), tok(b)).toFixed(2)}`).join(', '));
check('white text on the accent button meets 4.5:1', ratio('#ffffff', tok('accent')) >= 4.5, ratio('#ffffff', tok('accent')).toFixed(2));
check('footer text and focus ring contrast', ratio('#f1ede3', tok('ink')) >= 4.5 && ratio(tok('focus'), tok('bg')) >= 3, `footer=${ratio('#f1ede3', tok('ink')).toFixed(2)} focus=${ratio(tok('focus'), tok('bg')).toFixed(2)}`);

// ---- 5. content-system tests in a temporary copy (run once, on the launch build, so sitemap/indexing behaviour is the real one) ----
if (!previewBuilt) {
// The two origin variables are blanked unless a test sets them, so the result never depends on the developer's environment.
function runBuild(srcDir, outDir, env = {}, launch = true) { return spawnSync(process.execPath, [path.join(ROOT, 'scripts/build.mjs'), '--src', srcDir, '--out', outDir, '--registers', path.join(outDir, '_reg'), ...(launch ? ['--launch'] : [])], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SITE_ORIGIN: '', VERCEL_PROJECT_PRODUCTION_URL: '', ...env } }); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-test-'));
const copy = (name) => { const d = path.join(tmp, name); fs.cpSync(path.join(ROOT, 'src'), d, { recursive: true }); return d; };
const art = (extra = {}) => {
  const base = { id: 'A900', title: 'Fixture Bathroom Guide With A Fairly Long Title To Test Wrapping On Narrow Screens', slug: 'fixture-bathroom-guide', status: 'published', datePublished: '2026-11-01', dateModified: '2026-11-02', description: 'A fixture article used only by the automated test.', category: 'room-resets', heroImage: '/assets/images/hero-small-apartment-schedule.svg', heroAlt: 'Fixture illustration', heroWidth: 1200, heroHeight: 675, metaTitle: 'Fixture Bathroom Guide', metaDescription: 'Fixture article for the test suite.', canonicalPath: '/guides/fixture-bathroom-guide/', related: '[A001]', ...extra };
  const fm = Object.entries(base).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${typeof v === 'string' && !/^\[/.test(v) && !/^\//.test(v) ? JSON.stringify(v) : v}`).join('\n');
  return `---\n${fm}\n---\n\nFixture intro paragraph.\n\n## First section\n\nText with a [link to the schedule](/guides/small-apartment-cleaning-schedule/).\n\n## Second section\n\n- one\n- two\n\n## Third section\n\n| A | B |\n|---|---|\n| 1 | 2 |\n`;
};
{
  const s = copy('add'); fs.writeFileSync(path.join(s, 'content/articles/fixture-bathroom-guide.md'), art());
  const o = path.join(tmp, 'add_out'); const r = runBuild(s, o);
  const page = path.join(o, 'guides/fixture-bathroom-guide/index.html');
  check('NEW ARTICLE: a valid new content file builds successfully', r.status === 0, (r.stderr || r.stdout).split('\n').slice(-3).join(' '));
  if (r.status === 0) {
    const ph = fs.readFileSync(page, 'utf8');
    check('NEW ARTICLE: real HTML page generated from the shared template', /<h1>Fixture Bathroom Guide/.test(ph) && /class="toc"/.test(ph) && /<table>/.test(ph) && /Related guides/.test(ph));
    check('NEW ARTICLE: homepage latest list updated', fs.readFileSync(path.join(o, 'index.html'), 'utf8').includes('fixture-bathroom-guide'));
    check('NEW ARTICLE: category hub lists it', fs.readFileSync(path.join(o, 'category/room-resets/index.html'), 'utf8').includes('fixture-bathroom-guide'));
    check('NEW ARTICLE: guides archive, search index, feed and sitemap include it', ['guides/index.html', 'search-index.json', 'feed.xml', 'sitemap.xml'].every((f) => fs.readFileSync(path.join(o, f), 'utf8').includes('fixture-bathroom-guide')));
    check('NEW ARTICLE: related link points back to Article 001 and Article 001 is unchanged in source', ph.includes('small-apartment-cleaning-schedule') && fs.readFileSync(path.join(s, 'content/articles/small-apartment-cleaning-schedule.md'), 'utf8') === fs.readFileSync(path.join(ROOT, 'src/content/articles/small-apartment-cleaning-schedule.md'), 'utf8'));
    check('NEW ARTICLE: long title page has one h1 and no unresolved links', (ph.match(/<h1[\s>]/g) || []).length === 1);
  }
}
{
  const s = copy('dup'); fs.writeFileSync(path.join(s, 'content/articles/dup.md'), art({ id: 'A901' }).replace('fixture-bathroom-guide', 'small-apartment-cleaning-schedule'));
  const r = runBuild(s, path.join(tmp, 'dup_out')); check('VALIDATION: duplicate slug stops the build with a helpful message', r.status === 1 && /duplicate slug/.test(r.stderr), (r.stderr.match(/duplicate slug[^\n]*/) || [''])[0]);
}
{
  const s = copy('img'); fs.writeFileSync(path.join(s, 'content/articles/x.md'), art({ heroImage: '/assets/images/does-not-exist.png' }));
  const r = runBuild(s, path.join(tmp, 'img_out')); check('VALIDATION: missing hero image stops the build', r.status === 1 && /heroImage file not found/.test(r.stderr));
}
{
  const s = copy('rel'); fs.writeFileSync(path.join(s, 'content/articles/x.md'), art({ related: '[A404]' }));
  const r = runBuild(s, path.join(tmp, 'rel_out')); check('VALIDATION: unknown related article ID stops the build', r.status === 1 && /related article ID "A404"/.test(r.stderr));
}
{
  const s = copy('cat'); fs.writeFileSync(path.join(s, 'content/articles/x.md'), art({ category: 'nope' }));
  const r = runBuild(s, path.join(tmp, 'cat_out')); check('VALIDATION: unknown category stops the build', r.status === 1 && /category "nope" does not exist/.test(r.stderr));
}
{
  const s = copy('field'); fs.writeFileSync(path.join(s, 'content/articles/x.md'), art({ description: undefined }));
  const r = runBuild(s, path.join(tmp, 'field_out')); check('VALIDATION: missing required field stops the build', r.status === 1 && /missing required field "description"/.test(r.stderr));
}
{
  const s = copy('date'); fs.writeFileSync(path.join(s, 'content/articles/x.md'), art({ datePublished: '2026-13-45' }));
  const r = runBuild(s, path.join(tmp, 'date_out')); check('VALIDATION: malformed date stops the build', r.status === 1 && /datePublished must be a real date/.test(r.stderr));
}
{
  const s = copy('draft'); fs.writeFileSync(path.join(s, 'content/articles/x.md'), art({ status: 'draft' }));
  const o = path.join(tmp, 'draft_out'); const r = runBuild(s, o);
  check('DRAFTS: a new draft is accepted but not published anywhere', r.status === 0 && !fs.existsSync(path.join(o, 'guides/fixture-bathroom-guide')) && !fs.readFileSync(path.join(o, 'sitemap.xml'), 'utf8').includes('fixture-bathroom-guide'));
}
{
  const s = copy('cats'); const cj = path.join(s, 'content/categories/categories.json'); const arr = JSON.parse(fs.readFileSync(cj, 'utf8')); arr.push({ id: 'laundry', slug: 'laundry', name: 'Laundry', description: 'Laundry routines.', intro: 'Laundry intro.', order: 5 }); fs.writeFileSync(cj, JSON.stringify(arr));
  const o = path.join(tmp, 'cats_out'); const r = runBuild(s, o);
  check('NEW CATEGORY: adding a category record creates its hub and footer link', r.status === 0 && fs.existsSync(path.join(o, 'category/laundry/index.html')) && fs.readFileSync(path.join(o, 'index.html'), 'utf8').includes('category/laundry/'));
}
// ---- 6. public origin: hosting-provided address replaces the placeholder; a real configured domain always wins ----
{
  const PLACEHOLDER = 'resetminutes.example';
  const textOut = (o) => walk(o).filter((f) => /\.(html|xml|js|json|txt|webmanifest)$/.test(f) && !f.includes('_reg'));
  const outHas = (o, needle) => textOut(o).filter((f) => fs.readFileSync(f, 'utf8').includes(needle)).map((f) => path.relative(o, f).replace(/\\/g, '/'));
  const canonsOf = (o) => walk(o).filter((f) => f.endsWith('.html')).map((f) => (fs.readFileSync(f, 'utf8').match(/<link rel="canonical" href="([^"]*)"/) || [])[1]);

  const vercelHost = 'reset-minutes-preview.vercel.app';
  { // Vercel system variable, launch build
    const s = copy('o1'); const o = path.join(tmp, 'o1_out'); const r = runBuild(s, o, { VERCEL_PROJECT_PRODUCTION_URL: vercelHost });
    check('ORIGIN: VERCEL_PROJECT_PRODUCTION_URL replaces the placeholder in every canonical, the sitemap, robots.txt, the feed and site-config', r.status === 0 && canonsOf(o).every((c) => c.startsWith(`https://${vercelHost}/`) || c === `https://${vercelHost}/404.html`) && ['sitemap.xml', 'robots.txt', 'feed.xml', 'site-config.js'].every((f) => fs.readFileSync(path.join(o, f), 'utf8').includes(`https://${vercelHost}`)), (r.stderr || '').slice(0, 200));
    check('ORIGIN: no output file mentions the placeholder host once a hosting address is available', outHas(o, PLACEHOLDER).length === 0, outHas(o, PLACEHOLDER).join(', '));
    check('ORIGIN: the build log says where the origin came from', /Origin taken from the hosting environment: https:\/\/reset-minutes-preview\.vercel\.app/.test(r.stdout));
  }
  { // preview build: noindex stays, banner no longer says "placeholder"
    const s = copy('o2'); const o = path.join(tmp, 'o2_out'); const r = runBuild(s, o, { VERCEL_PROJECT_PRODUCTION_URL: vercelHost }, false);
    const home = fs.readFileSync(path.join(o, 'index.html'), 'utf8');
    check('ORIGIN (preview build): pages stay noindex,nofollow, canonicals use the hosting address, banner does not mention a placeholder', r.status === 0 && /content="noindex, nofollow"/.test(home) && home.includes(`href="https://${vercelHost}/"`) && !/placeholder address/.test(home));
  }
  { // explicit SITE_ORIGIN beats the Vercel variable
    const s = copy('o3'); const o = path.join(tmp, 'o3_out'); const r = runBuild(s, o, { SITE_ORIGIN: 'https://staging.example-host.dev/', VERCEL_PROJECT_PRODUCTION_URL: vercelHost });
    check('ORIGIN: an explicit SITE_ORIGIN takes precedence over the Vercel variable (trailing slash tolerated)', r.status === 0 && canonsOf(o).every((c) => c.startsWith('https://staging.example-host.dev/')) && outHas(o, vercelHost).length === 0);
  }
  { // invalid values are ignored
    const s = copy('o4'); const o = path.join(tmp, 'o4_out'); const r = runBuild(s, o, { SITE_ORIGIN: 'http://insecure.host', VERCEL_PROJECT_PRODUCTION_URL: 'bad host/with path' });
    check('ORIGIN: a non-https or malformed value is ignored and the page honestly says the origin is a placeholder', r.status === 0 && outHas(o, 'insecure.host').length === 0 && outHas(o, 'bad host').length === 0 && fs.readFileSync(path.join(o, 'sitemap.xml'), 'utf8').includes(PLACEHOLDER));
  }
  { // a real configured domain always wins
    const s = copy('o5'); const cf = path.join(s, 'site.config.json'); const c = JSON.parse(fs.readFileSync(cf, 'utf8')); c.siteOrigin = 'https://real-domain.example.org'; c.originIsPlaceholder = false; fs.writeFileSync(cf, JSON.stringify(c));
    const o = path.join(tmp, 'o5_out'); const r = runBuild(s, o, { SITE_ORIGIN: 'https://staging.example-host.dev', VERCEL_PROJECT_PRODUCTION_URL: vercelHost });
    check('ORIGIN: a real domain set in site.config.json (originIsPlaceholder false) is never overridden by environment variables', r.status === 0 && canonsOf(o).every((x) => x.startsWith('https://real-domain.example.org/')) && outHas(o, vercelHost).length === 0 && outHas(o, 'staging.example-host.dev').length === 0);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
fs.mkdirSync(path.join(ROOT, 'generated'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'generated', previewBuilt ? 'TEST_RESULTS_NODE_PREVIEW.json' : 'TEST_RESULTS_NODE.json'), JSON.stringify({ ran_utc: new Date().toISOString(), node: process.version, dist: path.basename(dist), total: results.length, failed: failed.length, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
