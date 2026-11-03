# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

AGENTS.md (imported above) is the binding rulebook: which files a content task may touch, the article workflow, and the hard limits. Follow it. This file only adds what AGENTS.md does not cover.

## Current state (differs from README)
- The site is **live**: `src/site.config.json` has `previewMode: false`, `originIsPlaceholder: false`, `siteOrigin: https://www.resetminutes.com`. README's "previewMode is true" section describes the pre-launch state.
- Vercel builds from GitHub (`vercel.json`: `npm run build` → `dist/`). Treat a push to `main` as a production deploy; do not push without the owner's say-so.
- Docs that README/AGENTS.md point to in `../` (`ARTICLE_TEMPLATE.md`, `CONTENT_SCHEMA_AND_VALIDATION.md`, `CONTENT_PUBLISHING_GUIDE.md`, `BEGINNER_DEPLOY_GUIDE.md`) are not in this repo or its parent folder. Use an existing article's frontmatter as the template and `scripts/content.mjs` as the schema.

## Commands
Node ≥ 18, zero dependencies (no `npm install` needed).

```bash
npm run validate          # content checks only; exit 1 on errors, warnings never fail
npm run build             # validate + build to dist/
npm test                  # validate, build dist/ + test it, build dist-launch/ (--launch) + test it
npm run check:workflow    # draft->publish->broken-content cycle on a temp copy; run after any scripts/ change
npm run serve             # serve dist/ at http://localhost:4173
```

- There is no per-test filter. To run the offline suite against one build: `node scripts/build.mjs --out dist && node scripts/test.mjs dist`.
- `scripts/qa_browser.mjs` (screenshots and checks across 5 viewports) needs `puppeteer-core` installed outside the repo (`QA_NODE_MODULES`) and Edge/Chrome (`QA_BROWSER`); not part of `npm test`.
- `scripts/make_assets.ps1` re-renders printable PDFs, previews, OG image and icons from `printable_sources/` with headless Edge. Windows only.
- Side effects: `npm run build` / `npm test` rewrite the tracked `generated/*.csv` registers (default `--registers generated`) and `npm test` rewrites `generated/TEST_RESULTS_NODE*.json`. Expect these in `git status` after running them; they are not "changed files" for a content task unless the owner wants them committed.

## Architecture
A hand-rolled static site generator in four modules, no framework:

- `scripts/md.mjs`: custom frontmatter parser (scalars, quoted strings, inline `[a, b]` arrays, `- ` lists only; anything else throws) and a minimal Markdown renderer. It is not CommonMark: e.g. nested lists are not supported, lines starting with `<` pass through as raw HTML, `::: kind Title` … `:::` becomes `<aside class="callout callout-kind">`, `{#id}` sets heading ids. Check here before using a Markdown feature in content.
- `scripts/content.mjs`: `loadContent()` reads config, categories, articles and pages and returns `{errors, warnings}`. **All validation lives here** and is shared by `validate.mjs`, `build.mjs` and the tests. It also checks internal body links against the set of known URLs and blocks published content from linking to drafts.
- `scripts/build.mjs`: one `layout()` shell plus a `build*()` function per page type, then sitemap, Atom feed, `search-index.json`, robots, manifest, `site-config.js`, and the CSV registers. Key behaviours:
  - Templates write site-root links (`/guides/…`); `layout()` rewrites them to **relative** paths (`../../`) so output works from any subpath or `file://`. `404.html` reverses this back to absolute.
  - Only `status: published` articles are built; drafts are validated but leak nowhere.
  - Articles always live at `/guides/<slug>/`; categories at `/category/<slug>/`; pages at `/<slug>/` (slugs `guides`, `category`, `printables`, `search`, `contact`, `assets` are reserved).
  - Category hubs are `noindex` until they hold `minArticlesForIndexableHub` (3) published articles; pages with `noindex: true` / `templateNotice` stay out of the sitemap.
  - `--launch` forces an indexable build regardless of `previewMode`. Origin resolution: real `siteOrigin` wins; only while `originIsPlaceholder` is true do `SITE_ORIGIN` then `VERCEL_PROJECT_PRODUCTION_URL` apply.
  - Ads (`ads.enabled`), analytics (`ga4MeasurementId`) and Pinterest verify are config-driven and off/blank by default; a test fails if ad or tracking code ships.
- `scripts/test.mjs`: (1) checks the built folder (links, anchors, assets, metadata, one h1, heading order, JSON-LD, sitemap/robots/feed, draft leaks, WCAG contrast computed from the CSS `:root` tokens), then (2) builds temporary copies of `src/` with fixture articles/configs to test validation errors, new-article/category propagation, origin precedence and Pinterest output.

## Test couplings to know about
- `src/content/articles/_draft-never-mix-cleaners-chart.md` is a deliberate draft fixture: the draft-leak test requires at least one `_draft*` file. Don't delete or publish it without replacing that fixture.
- Tests hard-code Article 001 (`small-apartment-cleaning-schedule`, id `A001`), its Pin image `daily-reset-checklist-pin.png`, and category ids `daily-resets` / `room-resets`. Renaming those breaks tests.
- The contrast tests read colour tokens from `styles.css`; changing token values can fail them.
- The home page's time tiers (`buildHome`) link to heading anchors inside A001 and point at the featured article. A001 carries `featured: true` for that reason; don't move `featured` to another article unless it has those headings.
- Tests that edit fixture files with regexes must tolerate CRLF (`\r?\n`): a Windows checkout has `core.autocrlf=true`.
- The Pinterest "no site-claim tag" test blanks `social.pinterestDomainVerify` in its temp copy, because the real config now holds the live claim code.
