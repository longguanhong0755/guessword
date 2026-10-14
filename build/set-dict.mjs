// build/set-dict.mjs <ja|ko|en> — refresh the embedded dictionary payload in js/data-<L>.js
// from D:/gw-dl/lang/dict-<L>.json (gzip level 9 + base64), keeping the master sources in sync
// with the external dictionary data files.
import fs from 'node:fs';
import zlib from 'node:zlib';

const L = process.argv[2];
const CONST = { en: 'GWDICT_B64', ja: 'GWDICT_JA_B64', ko: 'GWDICT_KO_B64' }[L];
if (!CONST) throw new Error('usage: node build/set-dict.mjs <ja|ko|en>');

const file = `D:/workspace/guessword/js/data-${L}.js`;
const gz = zlib.gzipSync(fs.readFileSync(`D:/gw-dl/lang/dict-${L}.json`), { level: 9 });
const lines = fs.readFileSync(file, 'utf8').split('\n');
const i = lines.findIndex(l => l.startsWith('const ' + CONST + '='));
if (i < 0) throw new Error(CONST + ' not found in ' + file);
const oldLen = lines[i].length;
lines[i] = 'const ' + CONST + '="' + gz.toString('base64') + '";';
fs.writeFileSync(file, lines.join('\n'));
console.log(`${L}: b64 line ${(oldLen / 1048576).toFixed(2)}MB -> ${(lines[i].length / 1048576).toFixed(2)}MB (raw gzip ${(gz.length / 1048576).toFixed(2)}MB)`);
