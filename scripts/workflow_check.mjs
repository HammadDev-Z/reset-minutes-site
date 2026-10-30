// End-to-end content workflow check, run on a TEMPORARY COPY of the project.
// 1. add a sample DRAFT article  -> validate -> build -> it must appear nowhere in the output
// 2. publish the sample           -> validate -> build -> it must appear in page, home, archive, category hub, search index, feed, sitemap
// 3. break the sample on purpose  -> validate must fail with a clear message and the build must not run
// The real src/content folder is never modified. Usage: node scripts/workflow_check.mjs [report.json]
import { cpSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = process.argv[2] ? resolve(process.argv[2]) : null;
const tmp = mkdtempSync(join(tmpdir(), 'wf-'));
const work = join(tmp, 'p');
cpSync(root, work, { recursive: true, filter: (s) => !/[\\/](dist|node_modules|\.vercel)([\\/]|$)/.test(s) });

const SLUG = 'workflow-sample-article';
const MARK = 'WORKFLOW-SAMPLE-MARKER-7731';
const file = join(work, 'src', 'content', 'articles', `${SLUG}.md`);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const run = (script, args = []) => spawnSync(process.execPath, [join(work, 'scripts', script), ...args], { cwd: work, encoding: 'utf8' });

const article = (status, extra = {}) => {
  const f = { id: 'A900', title: `${MARK} Sample Workflow Article`, slug: SLUG, status, datePublished: '2026-11-01', dateModified: '2026-11-01',
    description: `${MARK} A sample article used only to test the publishing workflow.`, metaTitle: 'Sample Workflow Article', metaDescription: 'A sample article used only to test the publishing workflow.',
    canonicalPath: `/guides/${SLUG}/`, category: 'daily-resets', tags: '[sample, workflow]', heroImage: '/assets/images/hero-small-apartment-schedule.svg',
    heroAlt: 'Illustration used for the workflow test.', heroWidth: 1200, heroHeight: 675, printable: '""', printableLabel: '""', related: '[A001]', toc: 'true', ...extra };
  const fm = Object.entries(f).map(([k, v]) => (typeof v === 'string' && !/^[\[\]"]|^(true|false)$/.test(v) && /[:#]/.test(v) ? `${k}: "${v}"` : `${k}: ${v}`)).join('\n');
  return `---\n${fm}\n---\n\nThis is the sample body. See the [main schedule](/guides/small-apartment-cleaning-schedule/).\n\n## A section\n\nSome text.\n`;
};

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
const textFiles = (d) => walk(d).filter((p) => /\.(html|xml|json|txt|js|css|webmanifest|csv)$/.test(p));
const outHas = (dist, needle) => textFiles(dist).filter((p) => readFileSync(p, 'utf8').includes(needle)).map((p) => p.slice(dist.length + 1).replace(/\\/g, '/'));
const dist = join(work, 'dist');

try {
  // baseline
  let v = run('validate.mjs'); check('baseline validate passes', v.status === 0, v.stdout.trim());
  let b = run('build.mjs', ['--out', 'dist']); check('baseline build passes', b.status === 0, b.stdout.trim().split('\n').pop());
  const baseCount = textFiles(dist).length;

  // 1. draft
  writeFileSync(file, article('draft'));
  v = run('validate.mjs'); check('draft: validate passes', v.status === 0, v.stdout.trim());
  rmSync(dist, { recursive: true, force: true });
  b = run('build.mjs', ['--out', 'dist']); check('draft: build passes', b.status === 0, b.stdout.trim().split('\n').pop());
  check('draft: no page folder is created', !existsSync(join(dist, 'guides', SLUG)));
  const leakM = outHas(dist, MARK), leakS = outHas(dist, SLUG);
  check('draft: title/description marker appears in NO output file', leakM.length === 0, leakM.join(', '));
  check('draft: slug appears in NO output file (pages, sitemap, feed, search index, navigation)', leakS.length === 0, leakS.join(', '));
  check('draft: output file count unchanged', textFiles(dist).length === baseCount, `${textFiles(dist).length} vs ${baseCount}`);

  // 2. published
  writeFileSync(file, article('published'));
  v = run('validate.mjs'); check('published: validate passes', v.status === 0, v.stdout.trim());
  rmSync(dist, { recursive: true, force: true });
  b = run('build.mjs', ['--out', 'dist']); check('published: build passes', b.status === 0, b.stdout.trim().split('\n').pop());
  const page = join(dist, 'guides', SLUG, 'index.html');
  check('published: article page exists', existsSync(page));
  const html = existsSync(page) ? readFileSync(page, 'utf8') : '';
  check('published: page has its own canonical', html.includes(`rel="canonical" href="https://resetminutes.example/guides/${SLUG}/"`));
  check('published: page has exactly one h1', (html.match(/<h1[\s>]/g) || []).length === 1);
  const rd = (p) => existsSync(join(dist, p)) ? readFileSync(join(dist, p), 'utf8') : '';
  check('published: listed on home page', rd('index.html').includes(`/guides/${SLUG}/`));
  check('published: listed in guides archive', rd('guides/index.html').includes(`/guides/${SLUG}/`));
  check('published: listed in its category hub (daily-resets)', rd('category/daily-resets/index.html').includes(`/guides/${SLUG}/`));
  check('published: NOT listed in another category hub (safe-cleaning)', !rd('category/safe-cleaning/index.html').includes(`/guides/${SLUG}/`));
  let idx = []; try { idx = JSON.parse(rd('search-index.json')); } catch {}
  check('published: present in search-index.json', JSON.stringify(idx).includes(SLUG));
  check('published: present in feed.xml', rd('feed.xml').includes(`/guides/${SLUG}/`));
  check('published: present in sitemap.xml', rd('sitemap.xml').includes(`/guides/${SLUG}/`));
  check('published: A001 still present everywhere (no regression)', rd('sitemap.xml').includes('/guides/small-apartment-cleaning-schedule/') && rd('feed.xml').includes('small-apartment-cleaning-schedule'));
  check('published: the global layout files were not edited', readFileSync(join(work, 'scripts', 'build.mjs'), 'utf8') === readFileSync(join(root, 'scripts', 'build.mjs'), 'utf8') && readFileSync(join(work, 'src', 'assets', 'css', 'styles.css'), 'utf8') === readFileSync(join(root, 'src', 'assets', 'css', 'styles.css'), 'utf8'));

  // 3. deliberate errors: validate must fail AND name the problem
  const problem = (r) => ((r.stdout || '') + (r.stderr || '')).split('\n').find((l) => /^\s+- /.test(l))?.trim() || '(no problem line)';
  const mustFail = (label, extra, expect) => {
    writeFileSync(file, article('published', extra));
    const r = run('validate.mjs');
    const msg = problem(r);
    check(`error: ${label} makes validate fail with a clear message`, r.status !== 0 && expect.test((r.stdout || '') + (r.stderr || '')), msg);
  };
  mustFail('unknown related ID', { related: '[A999]' }, /related article ID "A999" does not exist/);
  mustFail('unknown category', { category: 'no-such-category' }, /no-such-category/);
  mustFail('duplicate slug', { slug: 'small-apartment-cleaning-schedule' }, /duplicate slug/);
  mustFail('missing hero image', { heroImage: '/assets/images/does-not-exist.png' }, /does-not-exist\.png/);
  mustFail('malformed date', { datePublished: '11/01/2026' }, /date/i);
  // the real project must be untouched
  check('real project content folder untouched (no sample file)', !existsSync(join(root, 'src', 'content', 'articles', `${SLUG}.md`)));
} finally {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
}

const failed = results.filter((r) => !r.ok).length;
const report = { ran_utc: new Date().toISOString(), node: process.version, total: results.length, failed, results };
if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\n${results.length - failed}/${results.length} workflow checks passed`);
process.exit(failed ? 1 : 0);
