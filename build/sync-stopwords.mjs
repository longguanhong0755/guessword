// build/sync-stopwords.mjs — generate the classic-script copy of the shared
// stopword source used by the split dev build (index.html loads it before
// js/app.js). functions/api/_pool-stopwords.js stays the single source of
// truth; the composed deploy build inlines that file directly.
//
// Usage: node build/sync-stopwords.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SRC = path.join(ROOT, 'functions', 'api', '_pool-stopwords.js');
export const OUT = path.join(ROOT, 'js', 'pool-stopwords.js');
const HEADER = '// GENERATED from functions/api/_pool-stopwords.js by build/sync-stopwords.mjs — do not edit.\n';

export function clientStopwords() {
  const body = fs.readFileSync(SRC, 'utf8').replace(/^export\s+/gm, '');
  return HEADER + body;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const want = clientStopwords();
  if (process.argv.includes('--check')) {
    let have = '';
    try { have = fs.readFileSync(OUT, 'utf8'); } catch (e) { /* missing */ }
    if (have !== want) {
      console.error('js/pool-stopwords.js is out of sync with functions/api/_pool-stopwords.js');
      process.exit(1);
    }
    console.log('js/pool-stopwords.js is in sync');
  } else {
    fs.writeFileSync(OUT, want);
    console.log('wrote js/pool-stopwords.js');
  }
}
