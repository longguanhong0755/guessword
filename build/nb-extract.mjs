// Extract ConceptNet Numberbatch (en 19.08) vectors for the GuessWord vocabulary.
// Reads D:\gw-dl\numberbatch-en-19.08.txt.gz, keeps only words present in GWD,
// writes build/nb-vecs.f32 (N*300 float32 LE) + build/nb-report.json + build/words.json.
import fs from "node:fs";
import zlib from "node:zlib";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(ROOT, "..", "guessword.html");
const GZ = "D:\\gw-dl\\numberbatch-en-19.08.txt.gz";

// --- pull the GWD line out of the master html (it is the only line starting with 'const GWD=') ---
const html = fs.readFileSync(HTML, "utf8");
const gwdLine = html.split("\n").find(l => l.startsWith("const GWD="));
if (!gwdLine) throw new Error("GWD line not found");
const GWD = JSON.parse(gwdLine.slice("const GWD=".length, -1));
const words = GWD.words.split("|");
const N = GWD.N, D = GWD.D;
if (words.length !== N) throw new Error("words count mismatch");
fs.writeFileSync(path.join(ROOT, "words.json"), JSON.stringify(words));
console.log(`vocab: ${N} words x ${D} dims`);

const idx = new Map(words.map((w, i) => [w, i]));
const vecs = new Float32Array(N * D);          // rows left as all-zero for misses
const found = new Uint8Array(N);
let nFound = 0, nLines = 0, nBad = 0;

const rl = readline.createInterface({
  input: fs.createReadStream(GZ).pipe(zlib.createGunzip()),
  crlfDelay: Infinity,
});

const t0 = Date.now();
rl.on("line", (line) => {
  nLines++;
  if (nLines === 1) return;                    // "516782 300" header
  const sp = line.indexOf(" ");
  if (sp < 1) return;
  const term = line.slice(0, sp);
  const wi = idx.get(term);
  if (wi === undefined) return;
  const parts = line.slice(sp + 1).trim().split(/\s+/);
  if (parts.length !== D) { nBad++; return; }
  const off = wi * D;
  for (let d = 0; d < D; d++) vecs[off + d] = +parts[d];
  if (!found[wi]) { found[wi] = 1; nFound++; }
});

rl.on("close", () => {
  const misses = words.filter((_, i) => !found[i]);
  fs.writeFileSync(path.join(ROOT, "nb-vecs.f32"), Buffer.from(vecs.buffer));
  fs.writeFileSync(path.join(ROOT, "nb-report.json"), JSON.stringify({
    source: GZ, scannedLines: nLines, badLines: nBad,
    vocab: N, hits: nFound, missCount: misses.length, misses,
    seconds: (Date.now() - t0) / 1000,
  }, null, 1));
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s — hits ${nFound}/${N}, misses ${misses.length}, bad ${nBad}`);
  if (misses.length) console.log("misses:", misses.join(" "));
});
