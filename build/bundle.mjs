// build/bundle.mjs — single-file build for offline distribution.
// node build/bundle.mjs  ->  dist/guessword.html (index.html + css + js + en/ja/ko data inlined)
import fs from 'node:fs';
import path from 'node:path';
import { compose } from './compose.mjs';

const ROOT = 'D:/workspace/guessword';
const out = compose(ROOT);
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const f = path.join(ROOT, 'dist', 'guessword.html');
fs.writeFileSync(f, out);
console.log(f, (fs.statSync(f).size / 1048576).toFixed(2) + 'MB');
