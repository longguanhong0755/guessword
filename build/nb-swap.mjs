// Swap GuessWord's embedding payload: replace GWD.vec/min/max in guessword.html
// with int8-quantized ConceptNet Numberbatch vectors from build/nb-vecs.f32.
// Words listed in build/nb-report2.json:dropped (corpus junk with no NB vector)
// are removed from the vocabulary (words/level/N rebuilt). Everything else in
// the file stays byte-identical. Refuses to run on any remaining zero row.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(ROOT, "..", "guessword.html");

const html = fs.readFileSync(HTML, "utf8");
const lines = html.split("\n");
const li = lines.findIndex(l => l.startsWith("const GWD="));
if (li < 0) throw new Error("GWD line not found");
const GWD = JSON.parse(lines[li].slice("const GWD=".length, -1));
const N0 = GWD.N, D = GWD.D;
const words0 = GWD.words.split("|");

const f32all = new Float32Array(fs.readFileSync(path.join(ROOT, "nb-vecs.f32")).buffer);
if (f32all.length !== N0 * D) throw new Error(`nb-vecs.f32 size ${f32all.length} != ${N0 * D}`);

// drop corpus-junk words that have no Numberbatch vector
const rep2 = JSON.parse(fs.readFileSync(path.join(ROOT, "nb-report2.json"), "utf8"));
const dropSet = new Set(rep2.dropped);
const keep = [];
for (let i = 0; i < N0; i++) if (!dropSet.has(words0[i])) keep.push(i);
const N = keep.length;
console.log(`vocab ${N0} -> ${N} (dropped ${N0 - N})`);

const words = keep.map(i => words0[i]);
const level = keep.map(i => GWD.level[i]).join("");
const f32 = new Float32Array(N * D);
for (let k = 0; k < N; k++) f32.set(f32all.subarray(keep[k] * D, keep[k] * D + D), k * D);

// zero-row check (should be impossible after fallback + drop)
const missing = [];
for (let i = 0; i < N; i++) {
  let nz = false;
  for (let d = 0; d < D; d++) if (f32[i * D + d] !== 0) { nz = true; break; }
  if (!nz) missing.push(words[i]);
}
if (missing.length) {
  console.error(`ABORT: ${missing.length} words have no Numberbatch vector:`);
  console.error(missing.join(" "));
  process.exit(1);
}

// per-dimension affine min/max, matching the runtime decoder:
// value = min[d] + byte/255 * (max[d]-min[d])
const min = new Float64Array(D).fill(Infinity);
const max = new Float64Array(D).fill(-Infinity);
for (let i = 0; i < N; i++) {
  const off = i * D;
  for (let d = 0; d < D; d++) {
    const v = f32[off + d];
    if (v < min[d]) min[d] = v;
    if (v > max[d]) max[d] = v;
  }
}
const bytes = new Uint8Array(N * D);
for (let i = 0; i < N; i++) {
  const off = i * D;
  for (let d = 0; d < D; d++) {
    const span = max[d] - min[d] || 1;
    bytes[off + d] = Math.round((f32[off + d] - min[d]) / span * 255);
  }
}

GWD.N = N;
GWD.words = words.join("|");
GWD.level = level;
GWD.vec = Buffer.from(bytes).toString("base64");
GWD.min = Array.from(min, v => +v.toFixed(8));
GWD.max = Array.from(max, v => +v.toFixed(8));

const newLine = "const GWD=" + JSON.stringify(GWD) + ";";
// keep the file's original line ending style for that line
if (lines[li].endsWith("\r")) lines[li] = newLine + "\r"; else lines[li] = newLine;
fs.writeFileSync(HTML, lines.join("\n"));
console.log(`swapped: vec b64 ${GWD.vec.length} chars (expect ${Math.ceil(N * D / 3) * 4}), min/max ${D} each`);
console.log("GWD now on line", li + 1);
