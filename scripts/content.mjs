// Loads and validates content. Used by build.mjs, validate.mjs and test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './md.mjs';

import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ARTICLE_REQUIRED = ['id', 'title', 'slug', 'status', 'datePublished', 'dateModified', 'description', 'category', 'heroImage', 'heroAlt', 'metaTitle', 'metaDescription', 'canonicalPath'];
const PAGE_REQUIRED = ['id', 'title', 'slug', 'status', 'description', 'metaTitle', 'metaDescription', 'canonicalPath'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function dateStr(v) { return v instanceof Date ? v.toISOString().slice(0, 10) : String(v); }

export function loadContent(srcDir = path.join(ROOT, 'src')) {
  const errors = [];
  const warnings = [];
  const config = JSON.parse(fs.readFileSync(path.join(srcDir, 'site.config.json'), 'utf8'));
  const categories = JSON.parse(fs.readFileSync(path.join(srcDir, 'content', 'categories', 'categories.json'), 'utf8'));
  const catIds = new Set();
  const catSlugs = new Set();
  for (const c of categories) {
    for (const k of ['id', 'slug', 'name', 'description', 'intro']) if (!c[k]) errors.push(`categories.json: category "${c.id || '?'}" is missing "${k}"`);
    if (catIds.has(c.id)) errors.push(`categories.json: duplicate category id "${c.id}"`);
    if (catSlugs.has(c.slug)) errors.push(`categories.json: duplicate category slug "${c.slug}"`);
    catIds.add(c.id); catSlugs.add(c.slug);
  }

  const readDir = (dir, kind) => {
    const full = path.join(srcDir, 'content', dir);
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full).filter((f) => f.endsWith('.md')).sort().map((f) => {
      const file = `src/content/${dir}/${f}`;
      try {
        const { data, body } = parseFrontmatter(fs.readFileSync(path.join(full, f), 'utf8'), file);
        return { kind, file, filename: f, data, body, mtime: fs.statSync(path.join(full, f)).mtime };
      } catch (e) { errors.push(e.message); return null; }
    }).filter(Boolean);
  };
  const articles = readDir('articles', 'article');
  const pages = readDir('pages', 'page');

  const ids = new Map(); const slugs = new Map(); const canon = new Map();
  const assetExists = (p) => fs.existsSync(path.join(srcDir, p.replace(/^\//, '')));
  for (const a of articles) {
    const d = a.data; const where = a.file;
    for (const k of ARTICLE_REQUIRED) if (d[k] === undefined || d[k] === '' || d[k] === null) errors.push(`${where}: missing required field "${k}"`);
    if (!['draft', 'published'].includes(d.status)) errors.push(`${where}: status must be "draft" or "published" (got "${d.status}")`);
    for (const k of ['datePublished', 'dateModified']) { if (d[k] !== undefined) { d[k] = dateStr(d[k]); if (!DATE_RE.test(d[k]) || isNaN(Date.parse(d[k]))) errors.push(`${where}: ${k} must be a real date written YYYY-MM-DD (got "${d[k]}")`); } }
    if (d.dateModified && d.datePublished && d.dateModified < d.datePublished) errors.push(`${where}: dateModified is earlier than datePublished`);
    if (d.slug && !SLUG_RE.test(d.slug)) errors.push(`${where}: slug "${d.slug}" must be lowercase letters, numbers and single hyphens`);
    if (d.id) { if (ids.has(d.id)) errors.push(`${where}: duplicate id "${d.id}" (also in ${ids.get(d.id)})`); ids.set(d.id, where); }
    if (d.slug) { if (slugs.has(d.slug)) errors.push(`${where}: duplicate slug "${d.slug}" (also in ${slugs.get(d.slug)})`); slugs.set(d.slug, where); }
    if (d.canonicalPath) { if (canon.has(d.canonicalPath)) errors.push(`${where}: duplicate canonicalPath "${d.canonicalPath}"`); canon.set(d.canonicalPath, where); if (!/^\/.*\/$/.test(d.canonicalPath)) errors.push(`${where}: canonicalPath must start and end with "/"`); if (d.slug && d.canonicalPath !== `/guides/${d.slug}/`) warnings.push(`${where}: canonicalPath "${d.canonicalPath}" differs from /guides/${d.slug}/ (the page is built at /guides/<slug>/)`); }
    if (d.category && !catIds.has(d.category)) errors.push(`${where}: category "${d.category}" does not exist in categories.json (known: ${[...catIds].join(', ')})`);
    if (d.heroImage && !assetExists(d.heroImage)) errors.push(`${where}: heroImage file not found: src${d.heroImage}`);
    if (d.printable && !assetExists(d.printable)) errors.push(`${where}: printable file not found: src${d.printable}`);
    if (d.heroImage && (!d.heroWidth || !d.heroHeight)) errors.push(`${where}: heroWidth and heroHeight are required with heroImage`);
    if (d.tags !== undefined && !Array.isArray(d.tags)) errors.push(`${where}: tags must be a list like [a, b]`);
    if (d.related !== undefined && !Array.isArray(d.related)) errors.push(`${where}: related must be a list of article IDs like [A001]`);
    if (!a.body.trim()) errors.push(`${where}: article body is empty`);
    if (d.metaTitle && String(d.metaTitle).length > 60) warnings.push(`${where}: metaTitle is ${String(d.metaTitle).length} characters (guideline: about 60 or fewer; not a rule)`);
    if (d.metaDescription && String(d.metaDescription).length > 160) warnings.push(`${where}: metaDescription is ${String(d.metaDescription).length} characters (guideline: about 160 or fewer; not a rule)`);
    if (d.heroAlt && String(d.heroAlt).length > 200) warnings.push(`${where}: heroAlt is long (${String(d.heroAlt).length} characters)`);
  }
  for (const a of articles) {
    for (const r of a.data.related || []) {
      if (!ids.has(r)) errors.push(`${a.file}: related article ID "${r}" does not exist`);
      else if (r === a.data.id) errors.push(`${a.file}: an article cannot list itself in related`);
    }
  }
  const pageSlugs = new Set();
  for (const p of pages) {
    for (const k of PAGE_REQUIRED) if (p.data[k] === undefined || p.data[k] === '') errors.push(`${p.file}: missing required field "${k}"`);
    if (p.data.slug) { if (pageSlugs.has(p.data.slug) || slugs.has(p.data.slug)) warnings.push(`${p.file}: slug "${p.data.slug}" is used more than once`); pageSlugs.add(p.data.slug); }
  }
  const reserved = new Set(['guides', 'category', 'printables', 'search', 'contact', 'assets']);
  for (const p of pages) if (reserved.has(p.data.slug)) errors.push(`${p.file}: slug "${p.data.slug}" is reserved by a built-in page`);
  // body shortcodes / internal links
  const known = new Set([...articles.map((a) => `/guides/${a.data.slug}/`), ...pages.map((p) => `/${p.data.slug}/`), '/', '/guides/', '/printables/', '/search/', '/contact/', ...categories.map((c) => `/category/${c.slug}/`)]);
  for (const item of [...articles, ...pages]) {
    for (const m of item.body.matchAll(/\]\((\/[^)\s#]*)(?:#[^)]*)?\)/g)) {
      const link = m[1];
      if (link.startsWith('/assets/')) { if (!assetExists(link)) errors.push(`${item.file}: linked file not found: src${link}`); continue; }
      if (!known.has(link)) errors.push(`${item.file}: internal link "${link}" does not match any page`);
    }
    for (const m of item.body.matchAll(/!\[[^\]]*\]\((\/assets\/[^)\s]+)/g)) if (!assetExists(m[1])) errors.push(`${item.file}: image not found: src${m[1]}`);
    // draft articles must not be linked from published content
  }
  const draftSlugs = new Set(articles.filter((a) => a.data.status === 'draft').map((a) => `/guides/${a.data.slug}/`));
  for (const item of [...articles.filter((a) => a.data.status === 'published'), ...pages]) {
    for (const m of item.body.matchAll(/\]\((\/guides\/[^)\s#]+)/g)) if (draftSlugs.has(m[1])) errors.push(`${item.file}: links to draft article ${m[1]}; publish it first or remove the link`);
  }
  for (const a of articles.filter((a) => a.data.status === 'published')) {
    for (const r of a.data.related || []) { const t = articles.find((x) => x.data.id === r); if (t && t.data.status === 'draft') errors.push(`${a.file}: related article ${r} is a draft`); }
  }
  return { config, categories, articles, pages, errors, warnings };
}
