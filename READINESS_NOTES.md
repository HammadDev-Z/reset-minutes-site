# Readiness notes: Pinterest and ad-network layout

What the theme does, what it does not claim, and what only the site owner can do.

## Built in
**Pinterest**
- Every article can carry a visible 2:3 Pin image (`pinImage`, `pinImageAlt`, `pinImageWidth`, `pinImageHeight`, optional `pinDescription` in the front matter). The build warns if the image is not 2:3.
- The "Save to Pinterest" button is a plain link to Pinterest's own share URL (opens in a new tab). The site loads no Pinterest script and shares nothing until the reader clicks.
- Pin image text must match what the page delivers. The first Pin lists the same six tasks and time budgets as the article.
- Article metadata for Rich Pins and search: `og:type=article`, `article:published_time`, `article:modified_time`, `article:section`, and `article:author` when an author is configured. Structured data (`BlogPosting`) lists a raster image.
- `social.pinterestDomainVerify` in `src/site.config.json` writes the `p:domain_verify` tag once Pinterest gives you the code.
- Nothing is hidden, nothing is automated, no engagement is manufactured.

**Ad-ready layout (ads are OFF: `ads.enabled` is false)**
- When enabled, labelled slots reserve space (280px in content, 600px sidebar on desktop only, none in the sidebar on phones) so a late ad cannot shift the text. Slots never come before the first heading. The footer keeps room for a sticky footer ad.
- Pages ship without cookies, forms or tracking by default and score 100 in the earlier Lighthouse runs on the previous build.

## Not verified and not claimed
- Journey's technical and content requirements page returned HTTP 403 earlier, so this theme is NOT confirmed against it. The ad-ready layout follows common publisher practice only. Nothing here says the site is approved or accepted by Journey, Mediavine or any network.
- The earlier research reads the Journey minimum as about 1,000 sessions in 30 days from tier-1 countries. Re-read the live requirement page before applying.
- Journey lists excessive AI use as a disqualifier. Write, edit and fact-check every article yourself and describe your process truthfully on the Editorial Policy page.
- Pinterest's Rich Pin validator and Search Console need your own login. Run them yourself after launch.

## Owner actions before applying to any ad network
1. Fill the About, Contact, Editorial Policy, Privacy and Terms pages with real facts (they are templates and `noindex` until then).
2. Add a consent tool and update the Privacy page before turning on ads or analytics.
3. Add Search Console and the Pinterest site claim (the code goes in `social.pinterestDomainVerify`).
4. Publish more guides. Hubs stay `noindex` until three guides exist.
