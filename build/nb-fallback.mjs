// Lemma fallback for Numberbatch misses: try morphological candidates
// (distributions->distribution, scowled->scowl, impressionistically->impressionistic, ...)
// copying vectors from vocab rows when the lemma is already in GWD, else rescanning the gz.
// Patches build/nb-vecs.f32 in place; writes build/nb-report2.json (recovered + dropped).
import fs from "node:fs";
import zlib from "node:zlib";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const GZ = "D:\\gw-dl\\numberbatch-en-19.08.txt.gz";
const D = 300;

const words = JSON.parse(fs.readFileSync(path.join(ROOT, "words.json"), "utf8"));
const N = words.length;
const idx = new Map(words.map((w, i) => [w, i]));
const rep = JSON.parse(fs.readFileSync(path.join(ROOT, "nb-report.json"), "utf8"));
const f32buf = fs.readFileSync(path.join(ROOT, "nb-vecs.f32"));
const f32 = new Float32Array(f32buf.buffer, f32buf.byteOffset, f32buf.length / 4);

function* candidates(w) {
  const has = s => w.endsWith(s);
  if (has("ically")) yield w.slice(0, -6) + "ic";
  if (has("ies")) yield w.slice(0, -3) + "y";
  if (has("ing")) { yield w.slice(0, -3); yield w.slice(0, -3) + "e"; }
  if (has("ed")) { yield w.slice(0, -2); yield w.slice(0, -2) + "e"; yield w.slice(0, -3); }
  if (has("ly")) yield w.slice(0, -2);
  if (has("ae")) yield w.slice(0, -2) + "a";
  if (has("ia")) yield w.slice(0, -2) + "ium";
  if (has("i")) yield w.slice(0, -1) + "us";
  if (has("es")) { yield w.slice(0, -2); yield w.slice(0, -2) + "is"; yield w.slice(0, -1); }
  if (has("s")) yield w.slice(0, -1);
}

const recovered = {}, needScan = new Map();   // lemma -> [miss words]
const isZero = i => { const o = i * D; for (let d = 0; d < D; d++) if (f32[o + d] !== 0) return false; return true; };

for (const m of rep.misses) {
  for (const c of candidates(m)) {
    if (recovered[m]) break;
    if (idx.has(c) && !isZero(idx.get(c))) {          // lemma already has a vector in vocab
      f32.set(f32.subarray(idx.get(c) * D, idx.get(c) * D + D), idx.get(m) * D);
      recovered[m] = c + " (vocab)";
    } else if (!idx.has(c)) {
      if (!needScan.has(c)) needScan.set(c, []);
      needScan.get(c).push(m);
    }
  }
}

if (needScan.size) {
  const lemmaSet = new Set(needScan.keys());
  const rl = readline.createInterface({ input: fs.createReadStream(GZ).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    if (++n === 1) continue;
    const sp = line.indexOf(" ");
    if (sp < 1) continue;
    const term = line.slice(0, sp);
    if (!lemmaSet.has(term)) continue;
    const parts = line.slice(sp + 1).trim().split(/\s+/);
    if (parts.length !== D) continue;
    const row = new Float32Array(D);
    for (let d = 0; d < D; d++) row[d] = +parts[d];
    for (const m of needScan.get(term)) {
      f32.set(row, idx.get(m) * D);
      recovered[m] = term;
    }
    lemmaSet.delete(term);
    if (!lemmaSet.size) break;
  }
}

fs.writeFileSync(path.join(ROOT, "nb-vecs.f32"), Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength));
const dropped = rep.misses.filter(m => !recovered[m]);
fs.writeFileSync(path.join(ROOT, "nb-report2.json"), JSON.stringify({ recovered, dropped }, null, 1));
console.log(`recovered ${Object.keys(recovered).length}/${rep.misses.length}, dropped ${dropped.length}`);
console.log("sample recovered:", Object.entries(recovered).slice(0, 12).map(([m, l]) => `${m}->${l}`).join(", "));
console.log("dropped:", dropped.join(" "));
