# AGENTS.md: rules for AI coding agents and new editors

This is a file-based content site. Most tasks are "add or update an article". Those tasks change **content files only**.

## What you may change without asking
- `src/content/articles/<slug>.md` (create or edit), `src/content/categories/categories.json` (add a category), `src/content/printables.json` (add a printable).
- New images in `src/assets/images/`, new PDFs in `src/assets/printables/`.

## What you must not change for a content task
`scripts/*.mjs`, `src/assets/css/styles.css`, `src/assets/js/main.js`, `src/site.config.json`, `vercel.json`, `package.json`. If a design or behaviour change is genuinely needed, say so and make it as a separate, clearly described change.

## Pin image fields (optional, per article)
`pinImage` (a 1000x1500 PNG in `src/assets/images/pins/`), `pinImageAlt`, `pinImageWidth`, `pinImageHeight`, optional `pinDescription`. The Pin text must match what the article actually delivers. All four of the first fields go together (the build checks it). See `READINESS_NOTES.md`.

## Where things live
| Need | Place |
|---|---|
| Colours, fonts, spacing, radius, shadows | `:root` tokens at the top of `src/assets/css/styles.css`. Do not hard-code colours elsewhere (print rules excepted) |
| Page shell: head, banner, header, nav, footer | `layout()` in `scripts/build.mjs` |
| One template per page type | `buildHome`, `buildArticle`, `buildGuides`, `buildCategory`, `buildPrintables`, `buildContact`, `buildSearch`, `buildPage`, `build404` in `scripts/build.mjs` |
| Markdown features (tables, `::: callout` fences, `{#id}` headings) | `scripts/md.mjs` |
| Required fields and every validation rule | `scripts/content.mjs` (documented in `../CONTENT_SCHEMA_AND_VALIDATION.md`) |
| Domain, email, author, analytics ID, previewMode | `src/site.config.json` only |

## The article workflow (always in this order)
1. Copy `../ARTICLE_TEMPLATE.md` to `src/content/articles/<slug>.md`. Use the next free `id` and a unique `slug`. Keep `status: draft`.
2. Write the body. Rules: times are *time budgets* unless real trial results are supplied; every safety claim has an official source link beside it and says no more than the source says; never recommend mixing cleaning products; never invent experience, photos, test results, credentials, testimonials or numbers; label illustrations as illustrations.
3. `npm run validate`. Fix every listed problem.
4. `npm run build` and `npm test`. Both must finish with no failures. Report the exact output.
5. Only when the owner approves: set `status: published`, then rebuild and test again. Drafts never appear in pages, sitemap, feed, search index or navigation (tested).
6. Report the list of files you changed. It should be the article, its assets, and nothing else.

`npm run check:workflow` re-proves the draft and publish behaviour on a temporary copy; run it after any change to `scripts/`.

## Hard limits
- Do not deploy to Production, add a domain, buy anything, add ads or analytics, or put a secret, token or personal data in any file.
- Do not set `previewMode` to `false` unless the owner has said the site is launching.
- Do not claim a test passed unless you ran it and read its output.
