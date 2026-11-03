// Static site build. No dependencies. Usage: node scripts/build.mjs [--out dist] [--src src] [--registers generated]
import fs from 'node:fs';
import path from 'node:path';
import { loadContent, ROOT } from './content.mjs';
import { renderMarkdown, esc, slugify } from './md.mjs';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : def; };
const SRC = path.resolve(ROOT, arg('src', 'src'));
const OUT = path.resolve(ROOT, arg('out', 'dist'));
const REG = path.resolve(ROOT, arg('registers', 'generated'));

const { config, categories, articles, pages, errors, warnings } = loadContent(SRC);
// Preview mode (site.config.json "previewMode": true) tells crawlers to keep every page out of search results,
// so a preview or first deployment on a public *.vercel.app address cannot be indexed by accident.
// `--launch` builds the real, indexable site without editing the config (used by the tests and for dry runs).
const previewMode = config.previewMode && !process.argv.includes('--launch');
for (const w of warnings) console.warn(`WARNING  ${w}`);
if (errors.length) {
  console.error('\nBUILD STOPPED: fix these content problems first:\n');
  for (const e of errors) console.error(`  - ${e}`);
  console.error(`\n${errors.length} problem(s). Nothing was written.`);
  process.exit(1);
}

const printables = JSON.parse(fs.readFileSync(path.join(SRC, 'content', 'printables.json'), 'utf8'));
for (const p of printables) for (const k of ['pdf', 'preview']) if (!fs.existsSync(path.join(SRC, p[k].replace(/^\//, '')))) { console.error(`BUILD STOPPED: printables.json refers to a missing file: src${p[k]}`); process.exit(1); }

const published = articles.filter((a) => a.data.status === 'published')
  .sort((a, b) => (b.data.datePublished + b.data.id).localeCompare(a.data.datePublished + a.data.id));
const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
// Public origin. A real domain in site.config.json always wins. While the config still holds the placeholder
// (originIsPlaceholder: true), use a hosting-provided address when the build can see one, so canonical URLs, the sitemap,
// robots.txt, the feed and Open Graph tags never point at a made-up host:
//   1. SITE_ORIGIN (explicit, full https origin, set by the owner as a build environment variable), else
//   2. https://$VERCEL_PROJECT_PRODUCTION_URL (Vercel system variable: a host name without scheme, available at build time).
// Anything that is not a plain https origin is ignored and the placeholder stays (the page then says so).
const hostCandidate = (process.env.SITE_ORIGIN || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).trim().replace(/\/$/, '');
const originFromHost = config.originIsPlaceholder && /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d+)?$/i.test(hostCandidate);
const origin = (originFromHost ? hostCandidate : config.siteOrigin).replace(/\/$/, '');
const placeholderOrigin = config.originIsPlaceholder && !originFromHost;
if (originFromHost) console.log(`Origin taken from the hosting environment: ${origin}`);
const abs = (p) => origin + p;
const YEAR = new Date().getUTCFullYear();

const records = []; // page register

function fmtDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
const articleUrl = (a) => `/guides/${a.data.slug}/`;
const articlesIn = (catId) => published.filter((a) => a.data.category === catId);
const hubIndexable = (n) => n >= config.minArticlesForIndexableHub;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function write(rel, content) {
  const f = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}

function jsonld(obj) { return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`; }
function breadcrumbLd(items) {
  return jsonld({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: abs(it.url) })) });
}
function breadcrumbHtml(items) {
  return `<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>${items.map((it, i) => (i === items.length - 1 ? `<li><span aria-current="page">${esc(it.name)}</span></li>` : `<li><a href="${it.url}">${esc(it.name)}</a></li>`)).join('')}</ol></nav>`;
}

const NAV = [
  { name: 'Start Here', url: '/start-here/' },
  { name: 'Guides', url: '/guides/' },
  { name: 'Printables', url: '/printables/' },
  { name: 'About', url: '/about/' },
  { name: 'Search', url: '/search/' }
];

// Wrap content in the shared layout. `url` is the page's own site-root path, e.g. "/guides/".
function layout({ url, title, description, canonicalPath, noindex = false, ogType = 'website', ld = [], main, bodyClass = '', type = 'page', h1Expected = true, lastmod = '', extraHead = '' }) {
  const depth = url === '/' ? 0 : url.split('/').filter(Boolean).length;
  const prefix = depth === 0 ? './' : '../'.repeat(depth);
  const fullTitle = title === config.siteName ? `${config.siteName}: ${config.tagline}` : `${title} | ${config.siteName}`;
  const ga = config.analytics.ga4MeasurementId
    ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(config.analytics.ga4MeasurementId)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${esc(config.analytics.ga4MeasurementId)}');</script>` : '';
  const banner = previewMode ? `<div class="preview-banner" role="note">Preview build for review. This is not a live website, the domain is not purchased and every page asks search engines not to index it.${placeholderOrigin ? ' Canonical URLs use a placeholder address.' : ''}</div>` : '';
  const navHtml = NAV.map((n) => `<li><a href="${n.url}"${n.url === url || (n.url !== '/' && url.startsWith(n.url)) ? ' aria-current="page"' : ''}>${n.name}</a></li>`).join('');
  const cats = categories.map((c) => `<li><a href="/category/${c.slug}/">${esc(c.name)}</a></li>`).join('');
  const html = `<!doctype html>
<html lang="${config.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(abs(canonicalPath))}">
<meta name="robots" content="${previewMode ? 'noindex, nofollow' : noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large'}">
<meta name="theme-color" content="${config.themeColor}">
<meta property="og:site_name" content="${esc(config.siteName)}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(title === config.siteName ? fullTitle : title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(abs(canonicalPath))}">
<meta property="og:image" content="${esc(abs(config.defaultOgImage))}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
${config.social.pinterestDomainVerify ? `<meta name="p:domain_verify" content="${esc(config.social.pinterestDomainVerify)}">\n` : ''}${extraHead}
<link rel="icon" href="/assets/images/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/assets/images/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/assets/images/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="alternate" type="application/atom+xml" title="${esc(config.siteName)} feed" href="/feed.xml">
<script>document.documentElement.classList.add('js')</script>
<link rel="stylesheet" href="/assets/css/styles.css">
${ld.join('\n')}
${ga}
</head>
<body class="${[bodyClass, config.ads.enabled ? 'has-ads' : ''].filter(Boolean).join(' ')}">
<a class="skip-link" href="#main">Skip to content</a>
${banner}
<header class="site-header">
<div class="container header-row">
<a class="brand" href="/"><svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><rect width="64" height="64" rx="14" fill="#14213d"/><circle cx="32" cy="32" r="19" fill="none" stroke="#f6f1e7" stroke-width="4" stroke-opacity=".35"/><path d="M32 13a19 19 0 1 1-18.07 13.1" fill="none" stroke="#f6f1e7" stroke-width="4" stroke-linecap="round"/><path d="M23.5 32.5l6 6 11-12.5" fill="none" stroke="#e8856b" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${esc(config.siteName)}</span></a>
<button class="nav-toggle" type="button" aria-controls="site-nav" aria-expanded="false">Menu</button>
<nav class="site-nav" id="site-nav" aria-label="Primary"><ul>${navHtml}</ul></nav>
</div>
</header>
${main}
<footer class="site-footer">
<div class="container">
<div class="footer-grid">
<div><h2>${esc(config.siteName)}</h2><p>${esc(config.siteDescription)}</p><p>Times on this site are time budgets, not measurements. Illustrations are labelled as illustrations.</p></div>
<div><h2>Explore</h2><ul><li><a href="/start-here/">Start here</a></li><li><a href="/guides/">All guides</a></li><li><a href="/printables/">Free printables</a></li><li><a href="/search/">Search</a></li>${cats}</ul></div>
<div><h2>About the site</h2><ul><li><a href="/about/">About</a></li><li><a href="/contact/">Contact</a></li><li><a href="/editorial-policy/">Editorial policy</a></li><li><a href="/privacy-policy/">Privacy policy</a></li><li><a href="/terms/">Terms of use</a></li><li><a href="/feed.xml">Feed (Atom)</a></li>${config.social.pinterest ? `<li><a href="${esc(config.social.pinterest)}" rel="me noopener">Follow on Pinterest</a></li>` : ''}</ul></div>
</div>
<p class="footer-note">&copy; ${YEAR} ${esc(config.siteName)}. General information only, not legal or medical advice. Follow product labels and care instructions.</p>
</div>
</footer>
<button class="to-top" type="button" aria-label="Back to top">&uarr;</button>
<script src="/site-config.js" defer></script>
<script src="/assets/js/main.js" defer></script>
</body>
</html>
`;
  const rewritten = html.replace(/(href|src|data-root|data-index)="\/(?!\/)([^"]*)"/g, (_, a, p) => `${a}="${prefix}${p}"`);
  const out = url === '/' ? 'index.html' : `${url.replace(/^\//, '')}index.html`;
  write(out, rewritten);
  const h1 = (main.match(/<h1[\s>]/g) || []).length;
  records.push({ url, file: out, type, title: fullTitle, description, canonical: abs(canonicalPath), h1_count: h1, indexable: !noindex && !previewMode, in_sitemap: !noindex, lastmod });
}

// -------- components --------
function printableCard(pdfPath, label, id = '') {
  const pr = printables.find((p) => p.pdf === pdfPath);
  const img = pr ? `<img src="${pr.preview}" alt="${esc(pr.previewAlt)}" width="${pr.previewWidth}" height="${pr.previewHeight}" loading="lazy" decoding="async">` : '';
  return `<aside class="printable-cta"${id ? ` id="${id}"` : ''} aria-label="Free printable">${img}<div><p><strong>${esc(label || 'Free printable')}</strong></p><p class="meta">Free. No email address needed. US Letter, readable in black and white.</p><a class="btn" href="${pdfPath}">Download the PDF</a></div></aside>`;
}
function postItem(a, headingLevel = 3) {
  const d = a.data; const c = catById[d.category];
  return `<li class="post-item" data-category="${d.category}"><img src="${d.heroImage}" alt="" width="${d.heroWidth}" height="${d.heroHeight}" loading="lazy" decoding="async"><div><p class="meta">${esc(c.name)} &middot; <time datetime="${d.dateModified}">${fmtDate(d.dateModified)}</time></p><h${headingLevel}><a class="stretched" href="${articleUrl(a)}">${esc(d.title)}</a></h${headingLevel}><p>${esc(d.description)}</p></div></li>`;
}
function relatedFor(a) {
  let list = (a.data.related || []).map((id) => published.find((x) => x.data.id === id)).filter(Boolean);
  if (!list.length) list = published.filter((x) => x.data.category === a.data.category && x.data.id !== a.data.id).slice(0, 3);
  return list;
}

// -------- home --------
function buildHome() {
  const featured = published.find((a) => a.data.featured) || published[0];
  const tiers = [
    ['5', 'About 5 minutes', 'The minimum day', '#the-minimum-day-about-5-minutes'],
    ['10', '10 minutes', 'The daily reset', '#the-10-minute-daily-reset'],
    ['20', '20 minutes', 'Reset plus a short room list', '#one-room-a-day-monday-to-friday'],
    ['40', '40 minutes', 'Reset plus a full room list', '#one-room-a-day-monday-to-friday']
  ];
  const tierHref = featured ? articleUrl(featured) : '/start-here/';
  const tierHtml = tiers.map(([n, u, t, h]) => `<div class="card tier is-link"><p class="num">${n}</p><p class="unit">minutes</p><h3><a class="stretched" href="${tierHref}${featured ? h : ''}">${t}<span class="arrow" aria-hidden="true"> &rarr;</span></a></h3></div>`).join('');
  const catHtml = categories.map((c) => { const n = articlesIn(c.id).length; return `<div class="card is-link"><h3><a class="stretched" href="/category/${c.slug}/">${esc(c.name)}</a></h3><p>${esc(c.description)}</p><p class="meta">${n ? plural(n, 'guide') : 'First guides coming soon'}</p></div>`; }).join('');
  const prev = printables[0];
  const main = `<main id="main" tabindex="-1">
<section class="hero"><div class="container hero-grid">
<div><p class="eyebrow">Cleaning routines for small homes</p><h1>A cleaning routine that fits the time you have</h1><p class="lead">Time-boxed plans, a minimum day for rough weeks and free printable checklists for renters and busy households. Set a timer, work until it rings, stop.</p>
<div class="hero-actions"><a class="btn" href="/start-here/">Start here</a><a class="btn btn-ghost" href="/printables/">Free printables</a></div></div>
<div class="hero-art"><img src="/assets/images/hero-home.svg" alt="Illustration of four time tiers: 5, 10, 20 and 40 minutes, each with a short label" width="800" height="640" fetchpriority="high"></div>
</div></section>
<section class="section band"><div class="container"><div class="section-head"><h2>Pick your time today</h2></div><div class="grid grid-4">${tierHtml}</div><p class="meta" style="margin-top:1rem">Every time is a time budget (how long to spend), not a measurement.</p></div></section>
${featured ? `<section class="section"><div class="container"><div class="section-head"><h2>Featured guide</h2></div><div class="feature"><img src="${featured.data.heroImage}" alt="${esc(featured.data.heroAlt)}" width="${featured.data.heroWidth}" height="${featured.data.heroHeight}" loading="lazy" decoding="async"><div><p class="eyebrow">${esc(catById[featured.data.category].name)}</p><h3 style="font-size:var(--step-2)">${esc(featured.data.title)}</h3><p>${esc(featured.data.description)}</p><a class="btn" href="${articleUrl(featured)}">Read the guide</a></div></div></div></section>` : ''}
<section class="section"><div class="container"><div class="section-head"><h2>Browse by topic</h2></div><div class="grid grid-4">${catHtml}</div></div></section>
<section class="section"><div class="container"><div class="section-head"><h2>Latest guides</h2><a href="/guides/">All guides</a></div>${published.length ? `<ul class="post-list">${published.slice(0, 6).map((a) => postItem(a)).join('')}</ul>` : '<div class="empty"><p>No guides are published yet.</p></div>'}</div></section>
<section class="section band"><div class="container feature"><div><p class="eyebrow">Free printables</p><h2>Print it, tape it up, write on it</h2><p>A daily card, a weekly room grid and a monthly rotation. US Letter, readable in black and white, and no email address needed.</p><a class="btn" href="/printables/">See the printables</a></div><img src="${prev.preview}" alt="${esc(prev.previewAlt)}" width="${prev.previewWidth}" height="${prev.previewHeight}" loading="lazy" decoding="async" style="max-width:260px;margin-inline:auto"></div></section>
<section class="section"><div class="container"><div class="section-head"><h2>How we make these guides</h2></div><ul class="trust"><li>Safety statements are linked to Poison Control, CDC or EPA pages next to the claim.</li><li>Times are time budgets. If measured times are ever published, the method and conditions will be shown with them.</li><li>Illustrations are labelled as illustrations, not photographs of a real home.</li><li>Pages that are still templates are marked as templates. Read the <a href="/editorial-policy/">editorial policy</a>.</li></ul></div></section>
</main>`;
  layout({ url: '/', title: config.siteName, description: config.siteDescription, canonicalPath: '/', type: 'home', main, bodyClass: 'home', ld: [jsonld({ '@context': 'https://schema.org', '@type': 'WebSite', name: config.siteName, url: abs('/') })] });
}

// -------- articles --------
function buildArticle(a) {
  const d = a.data; const c = catById[d.category];
  const parts = renderMarkdown(a.body);
  let html = parts.html;
  const hasShortcode = html.includes('{{printable}}');
  const card = d.printable ? printableCard(d.printable, d.printableLabel, 'free-printable') : '';
  html = html.replace(/<p>\{\{printable\}\}<\/p>/g, card).replace(/\{\{printable\}\}/g, card);
  if (d.printable && !hasShortcode) html += card;
  // Ad-ready layout: reserved, labelled slots exist only when ads.enabled is true (default false). They reserve height so a late-loading ad cannot shift the text.
  const slot = (name, cls = '') => `<aside class="ad-slot ${cls}" data-slot="${name}" aria-label="Advertisement"></aside>`;
  if (config.ads.enabled) {
    let h2Seen = 0;
    html = html.replace(/<h2[\s>]/g, (m) => (++h2Seen % 3 === 2 ? `${slot('in-content-' + h2Seen)}${m}` : m));
    html += slot('after-article');
  }
  const words = a.body.replace(/[#*|`>\-]/g, ' ').split(/\s+/).filter(Boolean).length;
  const readMin = Math.max(1, Math.round(words / 230));
  const h2s = parts.headings.filter((h) => h.level === 2);
  const showToc = d.toc !== false && h2s.length >= 3;
  const tocList = showToc ? `<details class="toc"><summary>In this guide</summary><ol>${h2s.map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ol></details>` : '';
  const toc = tocList || config.ads.enabled ? `<div class="side-rail">${tocList}${config.ads.enabled ? slot('sidebar', 'ad-sidebar') : ''}</div>` : '';
  const hasRail = Boolean(toc);
  const pinUrl = d.pinImage ? `https://www.pinterest.com/pin/create/button/?url=${encodeURIComponent(abs(articleUrl(a)))}&media=${encodeURIComponent(abs(d.pinImage))}&description=${encodeURIComponent(d.pinDescription || d.title)}` : '';
  const pinBlock = d.pinImage ? `<section class="save-box" aria-labelledby="save-h"><img src="${d.pinImage}" alt="${esc(d.pinImageAlt)}" width="${d.pinImageWidth}" height="${d.pinImageHeight}" loading="lazy" decoding="async"><div><h2 id="save-h">Save this routine for later</h2><p>Keep the daily reset where you will see it again. This opens Pinterest in a new tab, where you choose the board. Nothing is shared from this site.</p><a class="btn btn-pin" href="${esc(pinUrl)}" target="_blank" rel="noopener noreferrer">Save to Pinterest<span class="visually-hidden"> (opens in a new tab)</span></a></div></section>` : '';
  const rel = relatedFor(a);
  const author = config.author.name ? `<span>By ${config.author.url ? `<a href="${esc(config.author.url)}">${esc(config.author.name)}</a>` : esc(config.author.name)}</span>` : '';
  const crumbs = [{ name: 'Home', url: '/' }, { name: 'Guides', url: '/guides/' }, { name: c.name, url: `/category/${c.slug}/` }, { name: d.title, url: articleUrl(a) }];
  const main = `<main id="main" tabindex="-1"><div class="container">
${breadcrumbHtml(crumbs)}
<div class="article-top"><header class="article-head"><p class="eyebrow"><a href="/category/${c.slug}/" style="text-decoration:none">${esc(c.name)}</a></p><h1>${esc(d.title)}</h1><p class="dek">${esc(d.description)}</p>
<div class="byline">${author}<span>Published <time datetime="${d.datePublished}">${fmtDate(d.datePublished)}</time></span><span>Updated <time datetime="${d.dateModified}">${fmtDate(d.dateModified)}</time></span><span>${readMin} min read</span>${previewMode ? '<span>(preview-build dates)</span>' : ''}</div>
${d.printable ? '<div class="head-actions"><a class="btn" href="#free-printable">Get the free printable</a></div>' : ''}</header>
<figure class="article-hero"><img src="${d.heroImage}" alt="${esc(d.heroAlt)}" width="${d.heroWidth}" height="${d.heroHeight}" fetchpriority="high"><figcaption>${esc(d.heroCaption || 'Illustration created for this guide. It is not a photograph of a real home.')}</figcaption></figure></div>
<div class="article-layout${hasRail ? ' has-toc' : ''}"><article class="prose" id="article-body">${html}${pinBlock}</article>${toc}</div>
${rel.length ? `<section class="related" aria-labelledby="related-h"><h2 id="related-h">Related guides</h2><ul class="post-list">${rel.map((r) => postItem(r)).join('')}</ul></section>` : ''}
</div></main>`;
  const ld = [breadcrumbLd(crumbs), jsonld({
    '@context': 'https://schema.org', '@type': 'BlogPosting', headline: d.title, description: d.metaDescription,
    datePublished: d.datePublished, dateModified: d.dateModified, mainEntityOfPage: abs(d.canonicalPath),
    image: [...(d.pinImage ? [abs(d.pinImage)] : []), abs(config.defaultOgImage)], ...(config.author.name ? { author: { '@type': 'Person', name: config.author.name, ...(config.author.url ? { url: config.author.url } : {}) } } : {})
  })];
  const extraHead = [`<meta property="article:published_time" content="${d.datePublished}">`, `<meta property="article:modified_time" content="${d.dateModified}">`, `<meta property="article:section" content="${esc(c.name)}">`, ...(config.author.name ? [`<meta property="article:author" content="${esc(config.author.name)}">`] : [])].join('\n');
  layout({ url: articleUrl(a), title: d.metaTitle, description: d.metaDescription, canonicalPath: articleUrl(a), ogType: 'article', ld, main, type: 'article', lastmod: d.dateModified, extraHead });
}

// -------- archives and hubs --------
function buildGuides() {
  const idx = hubIndexable(published.length);
  const chips = `<ul class="chips" data-filter-bar aria-label="Filter guides by topic"><li><button class="chip" type="button" data-filter="all" aria-pressed="true">All</button></li>${categories.map((c) => `<li><button class="chip" type="button" data-filter="${c.id}" aria-pressed="false">${esc(c.name)}</button></li>`).join('')}</ul>`;
  const main = `<main id="main" tabindex="-1"><div class="container">${breadcrumbHtml([{ name: 'Home', url: '/' }, { name: 'Guides', url: '/guides/' }])}<header class="page-head"><h1>All guides</h1><p class="intro">Every published guide, newest first. ${plural(published.length, 'guide')} so far.</p></header>${chips}<p id="filter-status" class="meta" role="status" aria-live="polite"></p>${published.length ? `<ul class="post-list">${published.map((a) => postItem(a, 2)).join('')}</ul>` : '<div class="empty"><p>No guides are published yet.</p></div>'}<p class="meta" style="margin-top:2rem">Looking for something specific? <a href="/search/">Search the guides</a>.</p></div></main>`;
  layout({ url: '/guides/', title: 'All guides', description: 'Every published Reset Minutes guide: cleaning routines, room checklists, safety basics and printables for small homes.', canonicalPath: '/guides/', noindex: !idx, main, type: 'archive', ld: [breadcrumbLd([{ name: 'Home', url: '/' }, { name: 'Guides', url: '/guides/' }])] });
}
function buildCategory(c) {
  const list = articlesIn(c.id); const idx = hubIndexable(list.length);
  const crumbs = [{ name: 'Home', url: '/' }, { name: 'Guides', url: '/guides/' }, { name: c.name, url: `/category/${c.slug}/` }];
  const main = `<main id="main" tabindex="-1"><div class="container">${breadcrumbHtml(crumbs)}<header class="page-head"><p class="eyebrow">Topic</p><h1>${esc(c.name)}</h1><p class="intro">${esc(c.intro)}</p></header>${list.length ? `<ul class="post-list">${list.map((a) => postItem(a, 2)).join('')}</ul>` : `<div class="empty"><p><strong>No guides in this topic yet.</strong></p><p>The first guides are being prepared. In the meantime, start with the <a href="/start-here/">start-here page</a> or browse <a href="/guides/">all guides</a>.</p></div>`}</div></main>`;
  layout({ url: `/category/${c.slug}/`, title: c.name, description: c.description, canonicalPath: `/category/${c.slug}/`, noindex: !idx, main, type: 'category', ld: [breadcrumbLd(crumbs)] });
}

// -------- printables, contact, search, pages, 404 --------
function buildPrintables() {
  const cards = printables.map((p) => `<article class="pr-card"><img src="${p.preview}" alt="${esc(p.previewAlt)}" width="${p.previewWidth}" height="${p.previewHeight}" loading="lazy" decoding="async"><h2 style="font-size:var(--step-1)">${esc(p.title)}</h2><p>${esc(p.description)}</p><p class="meta">PDF &middot; ${p.pages === 1 ? '1 page' : p.pages + ' pages'} &middot; US Letter</p><a class="btn" href="${p.pdf}">Download the PDF</a></article>`).join('');
  const crumbs = [{ name: 'Home', url: '/' }, { name: 'Printables', url: '/printables/' }];
  const main = `<main id="main" tabindex="-1"><div class="container">${breadcrumbHtml(crumbs)}<header class="page-head"><h1>Free printables</h1><p class="intro">Checklists on US Letter paper that work in black and white. No email address needed. Times on every sheet are time budgets, not measurements.</p></header><div class="pr-grid">${cards}</div>
<section class="section"><h2>Using the printables</h2><ul><li>Print for your own household. Please do not sell or redistribute the files.</li><li>Use one cleaning product at a time and never mix products. Read every label.</li><li>These files were checked on screen and as PDFs. They have not been test-printed on every printer; if a margin is cut off on yours, use "fit to page" in the print dialog.</li></ul></section></div></main>`;
  layout({ url: '/printables/', title: 'Free printables', description: 'Free printable cleaning checklists for small homes: a daily card, a weekly room grid and a monthly rotation. US Letter, black-and-white friendly, no email needed.', canonicalPath: '/printables/', main, type: 'library', ld: [breadcrumbLd(crumbs)] });
}
function buildContact() {
  const email = config.contactEmail;
  const body = email
    ? `<p>Write to <a href="mailto:${esc(email)}">${esc(email)}</a>. Replies are sent when possible.</p>`
    : `<div class="template-notice" role="note"><p><strong>Contact address not set yet.</strong> The site owner adds it as <code>contactEmail</code> in <code>src/site.config.json</code> and rebuilds. Until then this page has no way to send a message, and no form is shown because nothing would receive it.</p></div>`;
  const main = `<main id="main" tabindex="-1"><div class="container"><header class="page-head"><h1>Contact</h1></header><div class="prose">${body}<h2>For corrections</h2><p>Include the page address and what is wrong. For a printable problem, say which printer and paper size you used.</p><p>We do not accept payment for reviews.</p></div></div></main>`;
  layout({ url: '/contact/', title: 'Contact', description: 'How to contact Reset Minutes for corrections and printable problems.', canonicalPath: '/contact/', noindex: !email, main, type: 'page' });
}
function buildSearch() {
  const main = `<main id="main" tabindex="-1"><div class="container"><header class="page-head"><h1>Search the guides</h1></header>
<form class="search-form" id="search-form" role="search" action="/search/" method="get" data-index="/search-index.json" data-root="/"><label class="visually-hidden" for="q">Search guides</label><input id="q" name="q" type="search" placeholder="Try: bathroom, minimum day, printable" autocomplete="off"><button class="btn" type="submit">Search</button></form>
<p id="results-status" class="meta" role="status" aria-live="polite">Search needs JavaScript. Without it, <a href="/guides/">browse all guides</a>.</p><ul class="results" id="results"></ul>
<noscript><p>Search needs JavaScript. <a href="/guides/">Browse all guides</a> instead.</p></noscript></div></main>`;
  layout({ url: '/search/', title: 'Search', description: 'Search Reset Minutes guides and printables.', canonicalPath: '/search/', noindex: true, main, type: 'search' });
}
function buildPage(p) {
  const d = p.data; const parts = renderMarkdown(p.body);
  const notice = d.templateNotice ? `<div class="template-notice" role="note"><strong>Template, not a finished page.</strong> The site owner must fill every bracketed field with true facts and have policy pages reviewed before launch. This page is excluded from search engines and the sitemap until then.</div>` : '';
  const main = `<main id="main" tabindex="-1"><div class="container"><header class="page-head"><h1>${esc(d.title)}</h1></header>${notice}<div class="prose">${parts.html}</div></div></main>`;
  layout({ url: `/${d.slug}/`, title: d.metaTitle, description: d.metaDescription, canonicalPath: d.canonicalPath, noindex: d.noindex === true, main, type: 'page' });
}
function build404() {
  const main = `<main id="main" tabindex="-1"><div class="container error-page"><p class="eyebrow">Error 404</p><h1>That page is not here</h1><p class="lead">The address may be mistyped or the guide may have moved.</p><div class="hero-actions"><a class="btn" href="/">Go to the home page</a><a class="btn btn-ghost" href="/guides/">Browse all guides</a><a class="btn btn-ghost" href="/search/">Search</a></div></div></main>`;
  // 404 is served from arbitrary paths, so it must use site-root absolute URLs. Layout's relative rewriting is bypassed.
  const tmp = records.length;
  layout({ url: '/404-page/', title: 'Page not found', description: 'The page you asked for was not found.', canonicalPath: '/404.html', noindex: true, main, type: '404' });
  const rec = records.pop();
  let html = fs.readFileSync(path.join(OUT, rec.file), 'utf8');
  fs.rmSync(path.join(OUT, '404-page'), { recursive: true, force: true });
  // convert the depth-1 relative prefix back to site-root absolute URLs
  html = html.replace(/(href|src|data-root|data-index)="\.\.\/([^"]*)"/g, (_, a, p) => `${a}="/${p}"`).replace('<meta name="robots" content="noindex, follow">', '<meta name="robots" content="noindex">');
  write('404.html', html);
  records.push({ ...rec, url: '/404.html', file: '404.html', in_sitemap: false });
}

// -------- machine files --------
function buildSitemap() {
  const items = records.filter((r) => r.in_sitemap).map((r) => `  <url><loc>${esc(r.canonical)}</loc>${r.lastmod ? `<lastmod>${r.lastmod}</lastmod>` : ''}</url>`);
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n${previewMode ? '<!-- PREVIEW BUILD: these pages are noindex until previewMode is set to false. Do not submit this sitemap yet. -->\n' : ''}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join('\n')}\n</urlset>\n`);
}
function buildFeed() {
  const updated = published.length ? published.map((a) => a.data.dateModified).sort().pop() : new Date().toISOString().slice(0, 10);
  const entries = published.map((a) => `  <entry>\n    <title>${esc(a.data.title)}</title>\n    <link href="${esc(abs(articleUrl(a)))}"/>\n    <id>${esc(abs(articleUrl(a)))}</id>\n    <published>${a.data.datePublished}T00:00:00Z</published>\n    <updated>${a.data.dateModified}T00:00:00Z</updated>\n    <summary>${esc(a.data.description)}</summary>\n  </entry>`);
  write('feed.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n  <title>${esc(config.siteName)}</title>\n  <subtitle>${esc(config.tagline)}</subtitle>\n  <link href="${esc(abs('/feed.xml'))}" rel="self"/>\n  <link href="${esc(abs('/'))}"/>\n  <id>${esc(abs('/'))}</id>\n  <updated>${updated}T00:00:00Z</updated>\n${entries.join('\n')}\n</feed>\n`);
}
function buildSearchIndex() {
  const docs = published.map((a) => ({ title: a.data.title, url: `guides/${a.data.slug}/`, description: a.data.description, category: catById[a.data.category].name, tags: a.data.tags || [], text: renderMarkdown(a.body).plain.slice(0, 3000) }));
  docs.push({ title: 'Start here', url: 'start-here/', description: pages.find((p) => p.data.slug === 'start-here')?.data.description || '', category: 'Page', tags: [], text: '' });
  docs.push({ title: 'Free printables', url: 'printables/', description: 'Free printable cleaning checklists for small homes.', category: 'Printables', tags: ['printable', 'checklist', 'pdf'], text: printables.map((p) => `${p.title} ${p.description}`).join(' ') });
  write('search-index.json', JSON.stringify(docs));
}

// -------- run --------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(path.join(SRC, 'assets'), path.join(OUT, 'assets'), { recursive: true });
if (fs.existsSync(path.join(SRC, 'favicon.ico'))) fs.copyFileSync(path.join(SRC, 'favicon.ico'), path.join(OUT, 'favicon.ico'));
write('site-config.js', `/* Generated from src/site.config.json. Public values only. */\nwindow.SITE_CONFIG = ${JSON.stringify({ siteName: config.siteName, siteOrigin: origin, originIsPlaceholder: placeholderOrigin, previewMode }, null, 2)};\n`);

buildHome();
for (const p of pages) buildPage(p);
buildGuides();
for (const a of published) buildArticle(a);
for (const c of categories) buildCategory(c);
buildPrintables();
buildContact();
buildSearch();
build404();
buildSearchIndex();
buildFeed();
buildSitemap();
// Crawling stays allowed on purpose: a crawler must be able to fetch a page to see its noindex tag.
write('robots.txt', `${previewMode ? '# PREVIEW BUILD: every page carries <meta name="robots" content="noindex, nofollow">. Set previewMode to false in src/site.config.json at launch.\n' : ''}User-agent: *\nAllow: /\n\nSitemap: ${abs('/sitemap.xml')}\n`);
write('site.webmanifest', JSON.stringify({ name: config.siteName, short_name: config.siteName, description: config.siteDescription, start_url: '/', display: 'browser', background_color: '#f6f1e7', theme_color: config.themeColor, icons: [{ src: '/assets/images/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/assets/images/icon-512.png', sizes: '512x512', type: 'image/png' }] }, null, 2));

// registers (reproducible from source content)
fs.mkdirSync(REG, { recursive: true });
const csv = (rows) => { const cols = Object.keys(rows[0]); const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`; return [cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c])).join(','))].join('\n') + '\n'; };
const bodyLinks = (a) => [...a.body.matchAll(/\]\((\/[^)\s#]*)/g)].map((m) => m[1]).filter((l) => !l.startsWith('/assets/'));
fs.writeFileSync(path.join(REG, 'CONTENT_REGISTER.csv'), csv(articles.map((a) => ({
  article_id: a.data.id, file: a.file, slug: a.data.slug, title: a.data.title, category: a.data.category, status: a.data.status,
  date_published: a.data.datePublished, date_modified: a.data.dateModified, file_modified_utc: a.mtime.toISOString(), hero_asset: a.data.heroImage, printable: a.data.printable || '',
  related_ids: (a.data.related || []).join(' '), internal_links: bodyLinks(a).join(' '), meta_title: a.data.metaTitle, meta_title_chars: String(a.data.metaTitle).length,
  meta_description: a.data.metaDescription, meta_description_chars: String(a.data.metaDescription).length, canonical_path: a.data.canonicalPath,
  in_public_build: a.data.status === 'published' ? 'yes' : 'no'
}))));
fs.writeFileSync(path.join(REG, 'WEBSITE_PAGE_REGISTER.csv'), csv(records.map((r) => ({ url_path: r.url, built_file: r.file, page_type: r.type, title: r.title, meta_description: r.description, canonical: r.canonical, h1_count: r.h1_count, indexable: r.indexable ? 'yes' : 'no (noindex)', in_sitemap: r.in_sitemap ? 'yes' : 'no' }))));
console.log(`Built ${records.length} pages, ${published.length} published article(s), ${articles.length - published.length} draft(s) excluded -> ${path.relative(process.cwd(), OUT) || '.'}`);





