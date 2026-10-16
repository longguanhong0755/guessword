/* =====================================================================
   Remote rank parity — hard evidence that a *deployed* GuessWord server
   (Cloudflare Pages Functions, or the self-hosted Node adaptor) computes
   exactly the same ranks and distances as the client-side buildRanks()
   in js/app.js.

   Unlike test-rank-parity.mjs (which drives the engine module locally over
   site/), this script talks to a live base URL over HTTP and builds its
   reference from the *deployed* data (meta + vector chunks fetched from the
   target), so it also proves the deployed artifact is complete and readable.

   Usage: node test-rank-parity-remote.mjs <baseURL> [langs...|all]
     node test-rank-parity-remote.mjs https://guessword.loongsite.com/
     node test-rank-parity-remote.mjs https://guessword.loongsite.com/ all
   Default langs: en fr (two of the largest pools). "all" = en ja ko fr de es.
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { LV_COUNTS, decodePack, buildRanksRef } from './build/parity-ref.mjs';

const ALL = ['en', 'ja', 'ko', 'fr', 'de', 'es'];
const BASE = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(BASE)) {
  console.error('usage: node test-rank-parity-remote.mjs <baseURL> [langs...|all]');
  process.exit(2);
}
const args = process.argv.slice(3);
const LANGS = args.length === 0 ? ['en', 'fr'] : (args[0] === 'all' ? ALL : args).filter((l) => ALL.includes(l));
if (!LANGS.length) { console.error('unknown lang (use en ja ko fr de es or all)'); process.exit(2); }

let failures = 0;
const fail = (m) => { failures++; console.log('  FAIL ' + m); };
const ok = (m) => console.log('  ok   ' + m);

async function get(pathname, ms = 180000) {
  const r = await fetch(BASE + pathname, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`GET ${pathname}: HTTP ${r.status}`);
  return r;
}
async function jpost(pathname, body) {
  const r = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch (e) { throw new Error(`POST ${pathname}: bad JSON (HTTP ${r.status}): ${t.slice(0, 120)}`); }
  if (!r.ok) throw new Error(`POST ${pathname}: HTTP ${r.status} ${t.slice(0, 160)}`);
  return j;
}

// deployed version stamp (window.__gwVER in index.html), for the record
try {
  const html = await (await get('/', 60000)).text();
  const m = /window\.__gwVER\s*=\s*"([^"]+)"/.exec(html);
  const remoteVER = m ? m[1] : '(not found)';
  let localVER = null;
  try {
    const local = fs.readFileSync(path.join('site', 'index.html'), 'utf8');
    const lm = /window\.__gwVER\s*=\s*"([^"]+)"/.exec(local);
    localVER = lm ? lm[1] : null;
  } catch (e) { /* local site/ optional */ }
  console.log(`deployed VER: ${remoteVER}${localVER ? ` | local site/ VER: ${localVER}` : ''}`);
  if (localVER && localVER !== remoteVER) fail(`VER mismatch: remote ${remoteVER} vs local site/ ${localVER}`);
} catch (e) { fail('cannot read / : ' + e.message); }

for (const L of LANGS) {
  console.log(`\n=== ${L} ===`);
  const t0 = Date.now();
  const meta = JSON.parse(await (await get(`/data/gw-${L}-meta.json`)).text());
  const parts = [];
  for (let i = 0; i < meta.chunks; i++) parts.push(new Uint8Array(await (await get(`/data/gw-${L}-vec-${i}.bin`)).arrayBuffer()));
  let total = 0;
  for (const p of parts) total += p.byteLength;
  if (total !== meta.N * meta.D) { fail(`vec size ${total} != N*D ${meta.N * meta.D}`); continue; }
  const vec = new Uint8Array(total);
  { let off = 0; for (const p of parts) { vec.set(p, off); off += p.byteLength; } }
  const P = decodePack(meta, vec);
  console.log(`  data ok: N=${P.N} D=${P.D} chunks=${meta.chunks} (${(total / 1048576).toFixed(1)}MB in ${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  const jNew = await jpost('/api/new', { lang: L, lo: 0, hi: LV_COUNTS[L] - 1, recent: [] });
  if (!jNew.t) { fail('/api/new: ' + JSON.stringify(jNew).slice(0, 160)); continue; }
  ok(`/api/new token (pool ${jNew.pool})`);

  const jH1 = await jpost('/api/hint', { t: jNew.t, r: 1 });
  if (!jH1.word || jH1.d !== 1 || !P.IDX.has(jH1.word)) { fail('/api/hint r=1: ' + JSON.stringify(jH1).slice(0, 160)); continue; }
  const secret = jH1.word;
  ok(`/api/hint r=1 reveals secret "${secret}"`);

  const ref = buildRanksRef(P, secret, L);
  if (!ref) { fail(`secret "${secret}" not in deployed word list`); continue; }

  // sample: spread + rank-adjacent words (exercises the 1e-6 tie jitter) + bounds + a non-vocab probe
  const sample = [];
  for (let k = 0; k < 30; k++) sample.push(P.WORDS[Math.floor(k * P.N / 30)]);
  for (const k of [1, 2, 3, 10, 100, 1000]) sample.push(ref.wordAt[Math.min(k, P.N) - 1]);
  sample.push(P.WORDS[0], P.WORDS[P.N - 1], secret);
  const words = [...new Set(sample)].slice(0, 45);
  const wordsWithNeg = [...words, 'zzzzqqq'];
  const jGuess = await jpost('/api/guess', { t: jNew.t, words: wordsWithNeg });
  const items = jGuess.items || [];
  if (items.length !== wordsWithNeg.length) fail(`/api/guess returned ${items.length} items for ${wordsWithNeg.length} words`);
  let bad = 0;
  items.forEach((it, ix) => {
    const w = wordsWithNeg[ix];
    if (w === 'zzzzqqq') { if (it !== null) { bad++; fail(`non-vocab word returned ${JSON.stringify(it)}`); } return; }
    const cr = ref.rankOf.get(w), cd = ref.distOf[cr - 1];
    if (!it || it.r !== cr || it.d !== cd) { bad++; if (bad < 4) fail(`guess ${w}: ${JSON.stringify(it)} vs r=${cr} d=${cd}`); }
  });
  if (!bad) ok(`/api/guess ranks+distances identical for ${wordsWithNeg.length} words (incl. non-vocab -> null)`);

  let hbad = 0;
  const ks = [1, 2, 3, 4, 7, 15, 42, 100, 333, 1000, 2500, Math.floor(P.N / 2), P.N].filter((k) => k <= P.N);
  for (const k of ks) {
    const jh = await jpost('/api/hint', { t: jNew.t, r: k });
    if (jh.word !== ref.wordAt[k - 1] || jh.r !== k || jh.d !== ref.distOf[k - 1]) {
      hbad++; fail(`hint r=${k}: ${JSON.stringify(jh)} vs word=${ref.wordAt[k - 1]} r=${k} d=${ref.distOf[k - 1]}`);
    }
  }
  if (!hbad) ok(`/api/hint word+rank+dist identical (${ks.length} ranks)`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL REMOTE PARITY CHECKS PASSED');
process.exit(failures ? 1 : 0);
