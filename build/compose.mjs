// build/compose.mjs — assemble the single-file form of the game from the split sources
// (index.html + css/app.css + js/data-*.js + js/app.js).
import fs from 'node:fs';
import path from 'node:path';

export const JS_SRC = ['js/data-en.js', 'js/data-extra.js', 'js/data-ja.js', 'js/data-ko.js', 'js/app.js'];

export function compose(root) {
  const rd = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\n$/, '');
  const css = rd('css/app.css');
  const parts = JS_SRC.map(rd);
  if (parts[parts.length - 1].startsWith('"use strict";\n')) parts[parts.length - 1] = parts[parts.length - 1].slice('"use strict";\n'.length);
  const js = ['"use strict";', ...parts].join('\n');
  const lines = fs.readFileSync(path.join(root, 'index.html'), 'utf8').split('\n');
  const out = [];
  let merged = false;
  for (const l of lines) {
    if (l === '<link rel="stylesheet" href="css/app.css">') {
      out.push('<style>', ...css.split('\n'), '</style>');
      continue;
    }
    if (/^<script src="js\/[^"]+"><\/script>$/.test(l)) {
      if (!merged) { out.push('<script>', ...js.split('\n'), '</script>'); merged = true; }
      continue;
    }
    out.push(l);
  }
  if (!merged) throw new Error('no script tags found in index.html');
  return out.join('\n');
}

if (process.argv[2] === '--dump') {
  process.stdout.write(compose(process.argv[3] || 'D:/workspace/guessword'));
}
