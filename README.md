# Reset Minutes site (static, file-based)

A small content site built from Markdown files. Zero dependencies: you need Node 18 or newer and nothing else (no `npm install` downloads anything).

```
src/content/articles/*.md     one file per article (frontmatter + Markdown)   <- you edit these
src/content/pages/*.md        Start Here, About, policies (templates)
src/content/categories/       topic hubs (categories.json)
src/content/printables.json   the printable PDFs shown on /printables/
src/site.config.json          the ONE settings file (domain, email, author, previewMode, analytics)
src/assets/                   css (design tokens first), js, images, printable PDFs
scripts/build.mjs             shared layout + page templates (home, article, hub, archive, printables, search, 404)
scripts/validate.mjs          content checks that stop a bad build
scripts/test.mjs              offline tests (preview build and launch build)
scripts/workflow_check.mjs    draft -> published workflow check, run on a temporary copy
vercel.json                   Vercel settings (static output, headers)
```

## Everyday commands
| Command | What it does |
|---|---|
| `npm run validate` | Checks every content file; lists every problem with the file name |
| `npm run build` | Validates, then writes the site to `dist/` |
| `npm run serve` | Serves `dist/` at http://localhost:4173 |
| `npm test` | Builds a preview build and a launch build and runs 75 checks on them (including how the public origin is chosen) |
| `npm run check:workflow` | Proves that a draft stays hidden and a published article appears everywhere (temporary copy; your content is never touched) |
| `npm run build:launch` | Builds the indexable version into `dist-launch/` for a dry run |
| `npm run build:upload` | Writes `../website_upload/` (the folder you upload to ordinary hosting) |

## Preview mode (important)
`src/site.config.json` has `"previewMode": true`. While it is true, **every page carries `noindex, nofollow`**, a banner says so, and nothing should appear in search results. Set it to `false` (and set the real `siteOrigin`, `originIsPlaceholder: false`) only when you really launch, then rebuild.

## Public origin (canonical URLs, sitemap, robots, feed)
A real domain in `site.config.json` (`originIsPlaceholder: false`) always wins. While the config still holds the placeholder, the build uses, in this order: the `SITE_ORIGIN` environment variable (a full `https://` origin), then `https://$VERCEL_PROJECT_PRODUCTION_URL` (a Vercel system variable, available at build time when the project exposes system environment variables). Invalid values are ignored. With neither, the placeholder `https://resetminutes.example` stays and the preview banner says so.

## Deploying
See `../BEGINNER_DEPLOY_GUIDE.md` (Vercel via GitHub, step by step) and `../VERCEL_BUILD_SETTINGS.md`. Settings in short: framework **Other**, root directory = this folder, build command `npm run build`, output directory `dist`, no environment variables required (optional: `SITE_ORIGIN`, see Public origin).

## Adding or editing an article
Read `../CONTENT_PUBLISHING_GUIDE.md`. Short version: copy `../ARTICLE_TEMPLATE.md` to `src/content/articles/<slug>.md`, keep `status: draft`, run `npm run validate`, then set `status: published` when the source check is done. Never edit `scripts/build.mjs` or `styles.css` just to add an article.

Coding agents: read `AGENTS.md` first.
