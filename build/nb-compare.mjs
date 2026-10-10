// Side-by-side neighbor quality check: old word2vec payload (backup html) vs
// new Numberbatch vectors (build/nb-vecs.f32). Prints top-15 neighbors per probe.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BAK = path.join(ROOT, "guessword.w2v.bak.html");
const TOP = 15;
const PROBES = ["cat", "happy", "car", "love", "war", "computer", "music", "doctor", "money", "beautiful", "run", "think"];

const words = JSON.parse(fs.readFileSync(path.join(ROOT, "words.json"), "utf8"));
const N = words.length, D = 300;
const idx = new Map(words.map((w, i) => [w, i]));

function normalizeRows(m) {
  for (let i = 0; i < N; i++) {
    let n2 = 0;
    const off = i * D;
    for (let d = 0; d < D; d++) n2 += m[off + d] * m[off + d];
    const inv = 1 / Math.sqrt(n2) || 0;
    for (let d = 0; d < D; d++) m[off + d] *= inv;
  }
  return m;
}

// old model: dequantize int8 payload from the backup html
const bakLine = fs.readFileSync(BAK, "utf8").split("\n").find(l => l.startsWith("const GWD="));
const G = JSON.parse(bakLine.slice("const GWD=".length, -1));
const raw = Buffer.from(G.vec, "base64");
const oldM = new Float32Array(N * D);
for (let i = 0; i < N; i++) {
  const off = i * D;
  for (let d = 0; d < D; d++) oldM[off + d] = G.min[d] + (raw[off + d] / 255) * (G.max[d] - G.min[d]);
}
normalizeRows(oldM);

// new model
const newM = normalizeRows(new Float32Array(fs.readFileSync(path.join(ROOT, "nb-vecs.f32")).buffer));

function topN(M, word) {
  const si = idx.get(word);
  const soff = si * D;
  const scores = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (i === si) { scores[i] = -2; continue; }
    let dot = 0;
    const off = i * D;
    for (let d = 0; d < D; d++) dot += M[off + d] * M[soff + d];
    scores[i] = dot;
  }
  const order = Array.from({ length: N }, (_, i) => i);
  order.sort((a, b) => scores[b] - scores[a]);
  return order.slice(0, TOP).map(i => words[i]);
}

for (const p of PROBES) {
  if (!idx.has(p)) { console.log(`\n### ${p} — NOT IN VOCAB`); continue; }
  const a = topN(oldM, p), b = topN(newM, p);
  console.log(`\n### ${p}`);
  console.log("  word2vec(旧): " + a.join(", "));
  console.log("  numberbatch(新): " + b.join(", "));
}
