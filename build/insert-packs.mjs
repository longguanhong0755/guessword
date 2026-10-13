// Insert per-language packs and dictionaries into guessword.html (idempotent).
// Produces const GW_<LANG>={...} and const GWDICT_<LANG>_B64="..." lines after the GWMAP line.
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(ROOT, "..", "guessword.html");
const LANGDIR = "D:/gw-dl/lang";
const LANGS = ["ja", "ko", "fr", "de", "es"];

const html = fs.readFileSync(HTML, "utf8");
const lines = html.split("\n");
const prefixes = [];
for (const L of LANGS) prefixes.push(`const GW_${L.toUpperCase()}=`, `const GWDICT_${L.toUpperCase()}_B64=`);

const gm = lines.findIndex(l => l.startsWith("const GWMAP="));
if (gm < 0) throw new Error("GWMAP line not found");

// drop previously inserted pack/dict lines (idempotence)
const kept = lines.filter(l => !prefixes.some(p => l.startsWith(p)));

const inserts = [];
for (const L of LANGS) {
  const pack = JSON.parse(fs.readFileSync(`${LANGDIR}/pack-${L}.json`, "utf8"));
  inserts.push(`const GW_${L.toUpperCase()}=` + JSON.stringify(pack) + ";");
  const dictRaw = fs.readFileSync(`${LANGDIR}/dict-${L}.json`);
  const gz = zlib.gzipSync(dictRaw, { level: 9 });
  inserts.push(`const GWDICT_${L.toUpperCase()}_B64="${gz.toString("base64")}";`);
  console.log(`${L}: pack ${(JSON.stringify(pack).length / 1048576).toFixed(2)}MB json + dict ${(gz.length / 1048576).toFixed(2)}MB gz`);
}

const gm2 = kept.findIndex(l => l.startsWith("const GWMAP="));
kept.splice(gm2 + 1, 0, ...inserts);
fs.writeFileSync(HTML, kept.join("\n"));
console.log(`inserted ${inserts.length} lines after GWMAP (line ${gm2 + 2}); file now ${(fs.statSync(HTML).size / 1048576).toFixed(1)}MB`);
