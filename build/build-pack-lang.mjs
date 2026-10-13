// Build per-language game data packs (GWD-format) from vocab + extracted vectors.
// Filters to words that actually have Numberbatch vectors, quantizes int8 per-dim,
// writes /d/gw-dl/lang/pack-<lang>.json  {lang, N, words, level, vec, min, max, answers}
import fs from "node:fs";

const LANG = "D:/gw-dl/lang";
const D = 300;
const LANGS = ["ja", "ko", "fr", "de", "es"];

for (const lang of LANGS) {
  const vocab = JSON.parse(fs.readFileSync(`${LANG}/vocab-${lang}.json`, "utf8"));
  const raw = fs.readFileSync(`${LANG}/vec-${lang}.f32`);
  const all = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  if (all.length !== vocab.length * D) throw new Error(`${lang}: vec count mismatch`);

  const keep = [];
  for (let i = 0; i < vocab.length; i++) {
    const off = i * D;
    let nz = false;
    for (let d = 0; d < D; d++) if (all[off + d] !== 0) { nz = true; break; }
    if (nz) keep.push(i);
  }
  const N = keep.length;
  const words = keep.map(i => vocab[i].w);
  const level = keep.map(i => vocab[i].lv).join("");
  const f32 = new Float32Array(N * D);
  for (let k = 0; k < N; k++) f32.set(all.subarray(keep[k] * D, keep[k] * D + D), k * D);

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

  const answers = level.split("").filter(c => c !== "9").length;
  const pack = {
    lang, N, D,
    words: words.join("|"),
    level,
    vec: Buffer.from(bytes).toString("base64"),
    min: Array.from(min, v => +v.toFixed(8)),
    max: Array.from(max, v => +v.toFixed(8)),
    answers,
  };
  fs.writeFileSync(`${LANG}/pack-${lang}.json`, JSON.stringify(pack));
  console.log(`${lang}: vocab ${N} (answers ${answers}, guess-only ${N - answers}) | pack ${(fs.statSync(`${LANG}/pack-${lang}.json`).size / 1048576).toFixed(2)} MB`);
}
