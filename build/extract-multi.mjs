// Extract ConceptNet Numberbatch (multilingual 19.08) vectors for the 5 new languages'
// candidate word lists in ONE pass. Terms look like /c/<lang>/<word>.
// Output per language: /d/gw-dl/lang/vec-<lang>.f32 (N*300 float32, candidate order) + cover-<lang>.json
import fs from "node:fs";
import zlib from "node:zlib";
import readline from "node:readline";

const LANG = "D:/gw-dl/lang";
const GZ = "D:/gw-dl/numberbatch-19.08.txt.gz";
const D = 300;
const LANGS = ["ja", "ko", "fr", "de", "es"];

const cands = {}, maps = {}, vecs = {}, hit = {}, t0 = Date.now();
for (const lang of LANGS) {
  cands[lang] = JSON.parse(fs.readFileSync(`${LANG}/vocab-${lang}.json`, "utf8"));
  maps[lang] = new Map();
  vecs[lang] = new Float32Array(cands[lang].length * D);
  hit[lang] = 0;
  cands[lang].forEach((c, i) => maps[lang].set(c.w.toLowerCase(), i));
}
console.log("candidates:", LANGS.map(l => `${l}=${cands[l].length}`).join(" "));

const rl = readline.createInterface({ input: fs.createReadStream(GZ).pipe(zlib.createGunzip()), crlfDelay: Infinity });
let n = 0, samples = [];
rl.on("line", (line) => {
  n++;
  if (n === 1) return;
  if (line[0] !== "/" || line[1] !== "c" || line[2] !== "/") return;   // keep /c/<lang>/<word> only
  const lang = line.slice(3, 5);
  const m = maps[lang];
  if (!m) return;
  const sp = line.indexOf(" ", 6);
  if (sp < 0) return;
  const word = line.slice(6, sp);
  if (word.includes("/")) return;                                       // skip sub-senses
  const wi = m.get(word.toLowerCase());
  if (wi === undefined) return;
  const parts = line.slice(sp + 1).trim().split(/\s+/);
  if (parts.length !== D) return;
  const off = wi * D;
  if (vecs[lang][off] === 0 && vecs[lang][off + 1] === 0) hit[lang]++;
  for (let d = 0; d < D; d++) vecs[lang][off + d] = +parts[d];
  if (samples.length < 8 && Math.random() < 0.001) samples.push(line.slice(0, 40));
});
rl.on("close", () => {
  for (const lang of LANGS) {
    fs.writeFileSync(`${LANG}/vec-${lang}.f32`, Buffer.from(vecs[lang].buffer));
    const missing = cands[lang].filter((c, i) => vecs[lang][i * D] === 0 && vecs[lang][i * D + 1] === 0).map(c => c.w);
    fs.writeFileSync(`${LANG}/cover-${lang}.json`, JSON.stringify({
      total: cands[lang].length, hits: hit[lang], missCount: missing.length, misses: missing.slice(0, 200),
    }, null, 1));
    console.log(`${lang}: ${hit[lang]}/${cands[lang].length} (${(100 * hit[lang] / cands[lang].length).toFixed(1)}%)`);
  }
  console.log(`lines=${n} seconds=${((Date.now() - t0) / 1000).toFixed(1)}`);
  console.log("sample terms:", samples.join(" | "));
});
