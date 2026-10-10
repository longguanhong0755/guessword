// Apply the vocab surgery: rebuild GWD in guessword.html without removed/merged words,
// and insert the GWMAP lemma-redirect line used by the runtime input normalizer.
// vec rows come from build/nb-vecs.f32 (indexed by build/words.json, the pre-swap 31,259 list).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(ROOT, "..", "guessword.html");
const D = 300;

const html = fs.readFileSync(HTML, "utf8");
const lines = html.split("\n");
const li = lines.findIndex(l => l.startsWith("const GWD="));
const GWD = JSON.parse(lines[li].slice("const GWD=".length, -1));
const curWords = GWD.words.split("|");
const N0 = GWD.N;

// map current word -> row in nb-vecs.f32 (old 31,259 vocab order)
const oldWords = JSON.parse(fs.readFileSync(path.join(ROOT, "words.json"), "utf8"));
const oldIdx = new Map(oldWords.map((w, i) => [w, i]));
const f32all = new Float32Array(fs.readFileSync(path.join(ROOT, "nb-vecs.f32")).buffer);
if (f32all.length !== oldWords.length * D) throw new Error("nb-vecs.f32 / words.json mismatch");

const remove = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, "remove-proper.json"), "utf8")));
const gwmap = JSON.parse(fs.readFileSync(path.join(ROOT, "merge-map.json"), "utf8"));

// sanity: every map value must survive in the final vocab
const gone = new Set([...remove, ...Object.keys(gwmap)]);
for (const [w, L] of Object.entries(gwmap)) {
  if (gone.has(L)) throw new Error(`dangling map ${w}->${L}`);
  if (!/^[a-z'-]+$/.test(w) || !/^[a-z'-]+$/.test(L)) throw new Error(`unsafe chars in ${w}:${L}`);
}

const keep = [];
for (let i = 0; i < N0; i++) if (!gone.has(curWords[i])) keep.push(i);
const N = keep.length;
console.log(`vocab ${N0} -> ${N}`);

const words = keep.map(i => curWords[i]);
const level = keep.map(i => GWD.level[i]).join("");
const f32 = new Float32Array(N * D);
for (let k = 0; k < N; k++) {
  const oi = oldIdx.get(words[k]);
  if (oi === undefined) throw new Error("word missing from nb-vecs: " + words[k]);
  f32.set(f32all.subarray(oi * D, oi * D + D), k * D);
}

// re-quantize over the kept rows (per-dim affine, matching the runtime decoder)
const min = new Float64Array(D).fill(Infinity);
const max = new Float64Array(D).fill(-Infinity);
for (let i = 0; i < N; i++) for (let d = 0; d < D; d++) {
  const v = f32[i * D + d];
  if (v < min[d]) min[d] = v;
  if (v > max[d]) max[d] = v;
}
const bytes = new Uint8Array(N * D);
for (let i = 0; i < N; i++) for (let d = 0; d < D; d++) {
  const span = max[d] - min[d] || 1;
  bytes[i * D + d] = Math.round((f32[i * D + d] - min[d]) / span * 255);
}

GWD.N = N;
GWD.words = words.join("|");
GWD.level = level;
GWD.vec = Buffer.from(bytes).toString("base64");
GWD.min = Array.from(min, v => +v.toFixed(8));
GWD.max = Array.from(max, v => +v.toFixed(8));

const gwmapStr = Object.entries(gwmap).map(([w, L]) => `${w}:${L}`).join(";");
lines[li] = "const GWD=" + JSON.stringify(GWD) + ";";
lines.splice(li + 1, 0, `const GWMAP="${gwmapStr}";`);
fs.writeFileSync(HTML, lines.join("\n"));
console.log(`GWD vec b64 ${GWD.vec.length} chars; GWMAP ${Object.keys(gwmap).length} pairs, ${gwmapStr.length} chars`);
