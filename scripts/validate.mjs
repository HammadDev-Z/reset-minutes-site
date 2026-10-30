// Validates content without building. Exit code 1 on errors. Warnings (SEO length guidelines) never fail.
import { loadContent } from './content.mjs';
const { articles, pages, categories, errors, warnings } = loadContent();
for (const w of warnings) console.warn(`WARNING  ${w}`);
if (errors.length) {
  console.error('\nCONTENT PROBLEMS (fix these, then run again):\n');
  for (const e of errors) console.error(`  - ${e}`);
  console.error(`\n${errors.length} problem(s).`);
  process.exit(1);
}
const pub = articles.filter((a) => a.data.status === 'published').length;
console.log(`Content OK: ${articles.length} article file(s) (${pub} published, ${articles.length - pub} draft), ${pages.length} page(s), ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}. ${warnings.length} warning(s).`);
