/* =====================================================================
   Rank parity test: the online engine (functions/api/_engine.js, driven
   here through its real HTTP handlers) must produce exactly the same
   ranks and distances as the client-side buildRanks() in js/app.js.

   Usage: node test-rank-parity.mjs            (uses site/ built by build-variant.mjs)
          node test-rank-parity.mjs en ja fr
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = 'D:/workspace/guessword';
const SITE = path.join(ROOT, 'site');
const LANGS = process.argv.slice(2).length ? process.argv.slice(2) : ['en', 'ja', 'fr'];
const LV_COUNTS = { en: 6, ja: 5, ko: 6, fr: 6, de: 6, es: 6 };

/* ---------- asset access over the built site/ ---------- */
function assetBytes(p) {
  const clean = p.split('?')[0].replace(/^\//, '');
  const file = path.join(SITE, clean);
  if (!fs.existsSync(file)) throw new Error('asset missing: ' + clean);
  return new Uint8Array(fs.readFileSync(file));
}
const fakeEnv = {
  ASSETS: {
    fetch: (req) => {
      try { return Promise.resolve(new Response(assetBytes(new URL(req.url).pathname))); }
      catch (e) { return Promise.resolve(new Response('missing', { status: 404 })); }
    },
  },
};
const ctx = (url, body) => ({
  request: new Request(url, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  env: fakeEnv,
});

/* ---------- client-side reference (verbatim algorithm from js/app.js) ---------- */
function rngRef(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
  let t = (h = Math.imul(h ^ h >>> 16, 2246822507), h = Math.imul(h ^ h >>> 13, 3266489909), (h ^= h >>> 16) >>> 0);
  return function () {
    t |= 0; t = t + 0x6D2B79F5 | 0;
    let r = Math.imul(t ^ t >>> 15, 1 | t);
    r = r + Math.imul(r ^ r >>> 7, 61 | r) ^ r;
    return ((r ^ r >>> 14) >>> 0) / 4294967296;
  };
}
function clientPack(L) {   // decodePack() + GWMAP-free path
  const meta = JSON.parse(fs.readFileSync(path.join(SITE, 'data', `gw-${L}-meta.json`), 'utf8'));
  const parts = [];
  for (let i = 0; i < meta.chunks; i++) parts.push(fs.readFileSync(path.join(SITE, 'data', `gw-${L}-vec-${i}.bin`)));
  const bytes = new Uint8Array(Buffer.concat(parts));
  const D2 = meta.D, N2 = meta.N;
  const words = meta.words.split('|');
  const unit = new Float32Array(N2 * D2);
  const min = meta.min, max = meta.max;
  for (let i = 0; i < N2; i++) for (let d = 0; d < D2; d++) unit[i * D2 + d] = min[d] + (bytes[i * D2 + d] / 255) * (max[d] - min[d]);
  for (let i = 0; i < N2; i++) {
    let n2 = 0;
    for (let d = 0; d < D2; d++) { const v = unit[i * D2 + d]; n2 += v * v; }
    const inv = 1 / Math.sqrt(n2) || 0;
    for (let d = 0; d < D2; d++) unit[i * D2 + d] *= inv;
  }
  return { D: D2, N: N2, WORDS: words, LVIDX: (() => { const lv = new Uint8Array(meta.level.length); for (let i = 0; i < lv.length; i++) lv[i] = +meta.level[i]; return lv; })(), UNIT: unit, IDX: new Map(words.map((w, i) => [w, i])) };
}
function buildRanksRef(P, secretWord) {   // verbatim buildRanks()
  const P_D = P.D, P_N = P.N, P_W = P.WORDS, P_U = P.UNIT;
  const si = P.IDX.get(secretWord);
  if (si === undefined) return null;
  const scores = new Float64Array(P_N);
  for (let i = 0; i < P_N; i++) {
    if (i === si) { scores[i] = 2; continue; }
    let dot = 0, off = i * P_D, soff = si * P_D;
    for (let d = 0; d < P_D; d++) dot += P_U[off + d] * P_U[soff + d];
    scores[i] = dot + rngRef(LANG_OF(P, secretWord) + "|" + secretWord + "|" + P_W[i])() * 1e-6;
  }
  const order = new Array(P_N);
  for (let i = 0; i < P_N; i++) order[i] = i;
  order.sort((a, b) => scores[b] - scores[a] || (P_W[a] < P_W[b] ? -1 : 1));
  const rankOf = new Map(), wordAt = new Array(P_N), distOf = new Array(P_N);
  const K = 3000 / P_N;
  let prevDist = 0;
  for (let r = 0; r < P_N; r++) {
    const i = order[r];
    rankOf.set(P_W[i], r + 1);
    wordAt[r] = P_W[i];
    const d = Math.max(prevDist + 1, 1 + Math.round(r * K));
    distOf[r] = d; prevDist = d;
  }
  return { rankOf, wordAt, distOf, N: P_N, K };
}
// the client seeds rng() with the *current* language code, which equals the pack's language
let CUR_LANG = 'en';
function LANG_OF(P, w) { return CUR_LANG; }

// daily-challenge pool filter (verbatim from js/app.js secretOk + the level range)
const DAILY_STOP = new Set(["the","a","an","and","or","but","is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","could","should","may","might","must","can","i","you","he","she","it","we","they"]);
const DAILY_BLOCKED = ["rape","rapes","retard","retards","nigga","niggas","nigger","niggers","faggot","faggots","negro","coon","kike","spastic"];

/* ---------- checks ---------- */
let failures = 0;
const fail = (m) => { failures++; console.log('  FAIL ' + m); };
const ok = (m) => console.log('  ok   ' + m);

const ENGINE_URL = pathToFileURL(path.join(SITE, 'functions', 'api', '_engine.js')).href;
const { handle, createEngine } = await import(ENGINE_URL);

for (const L of LANGS) {
  console.log(`\n=== ${L} ===`);
  CUR_LANG = L;
  const P = clientPack(L);
  const eng = createEngine((p) => Promise.resolve(assetBytes(p)));
  const S = await eng.loadLang(L);

  console.log(`N=${P.N} D=${P.D} words=${P.WORDS.length}`);
  if (S.N !== P.N || S.D !== P.D) fail('N/D mismatch');

  // unit matrices must be bit-identical
  let same = S.UNIT.length === P.UNIT.length;
  if (same) for (let i = 0; i < S.UNIT.length; i++) if (S.UNIT[i] !== P.UNIT[i]) { same = false; console.log('   first diff at', i, S.UNIT[i], P.UNIT[i]); break; }
  same ? ok('unit matrix bit-identical') : fail('unit matrix differs');

  // distances must match for every rank
  const ref = buildRanksRef(P, P.WORDS[Math.floor(P.N / 3)]);
  let distOk = true;
  for (let r = 0; r < P.N; r++) if (S.DIST[r] !== ref.distOf[r]) { distOk = false; fail(`dist table r=${r}: ${S.DIST[r]} vs ${ref.distOf[r]}`); break; }
  distOk && ok('distance table identical for all ' + P.N + ' ranks');

  // ranks: sample secrets x sample words through the real handlers
  const secrets = [P.WORDS[3], P.WORDS[Math.floor(P.N / 2)], P.WORDS[P.N - 5]];
  for (const secret of secrets) {
    const r2 = buildRanksRef(P, secret);
    const pool = Array.from({ length: 300 }, (_, k) => P.WORDS[Math.floor(k * P.N / 300)]);
    pool.push(secret, P.WORDS[0], P.WORDS[P.N - 1]);

    // drive the actual /api/guess handler via a forged token-free path: use engine directly
    const si = P.IDX.get(secret);
    const scores = eng.scorePass(S, si, secret);
    let bad = 0;
    for (const w of pool) {
      const wi = P.IDX.get(w);
      const rServer = w === secret ? 1 : eng.rankAt(S, scores, wi);
      const rClient = r2.rankOf.get(w);
      const dServer = S.DIST[rServer - 1], dClient = r2.distOf[rClient - 1];
      if (rServer !== rClient || dServer !== dClient) { bad++; if (bad < 4) fail(`${w}: server r=${rServer} d=${dServer} vs client r=${rClient} d=${dClient}`); }
    }
    if (!bad) ok(`ranks identical for ${pool.length} words (secret "${secret}")`);

    // hint selection: word at rank k must match client wordAt[k-1]
    let hbad = 0;
    const ks = [1, 2, 3, 4, 7, 15, 42, 100, 333, 1000, 2500, Math.floor(P.N / 2), P.N];
    for (const k of ks) {
      if (k > P.N) continue;
      const wi = k === 1 ? si : eng.indexAtRank(S, scores, k);
      const w = P.WORDS[wi];
      if (w !== r2.wordAt[k - 1]) { hbad++; fail(`hint rank ${k}: ${w} vs ${r2.wordAt[k - 1]}`); }
    }
    if (!hbad) ok(`hint rank -> word identical (${ks.length} ranks)`);
  }

  // full HTTP layer: /api/new -> /api/guess -> /api/hint -> /api/def
  const base = 'https://x.test';
  const rNew = await handle(ctx(base + '/api/new', { lang: L, lo: 0, hi: 3, recent: [] }), 'new');
  const jNew = await rNew.json();
  if (!jNew.t) fail('api/new failed: ' + JSON.stringify(jNew)); else ok('api/new token ok (pool ' + jNew.pool + ')');

  // decode the token by exercising /api/hint r=1 (the server reveals the secret there)
  const rHint1 = await handle(ctx(base + '/api/hint', { t: jNew.t, r: 1 }), 'hint');
  const jHint1 = await rHint1.json();
  if (!jHint1.word || jHint1.d !== 1) fail('api/hint r=1: ' + JSON.stringify(jHint1)); else ok('api/hint r=1 reveals secret "' + jHint1.word + '"');

  const secret2 = jHint1.word;
  const r2b = buildRanksRef(P, secret2);
  const sample = [P.WORDS[10], P.WORDS[1000], secret2];
  const rGuess = await handle(ctx(base + '/api/guess', { t: jNew.t, words: sample }), 'guess');
  const jGuess = await rGuess.json();
  let gbad = 0;
  (jGuess.items || []).forEach((it, ix) => {
    const w = sample[ix];
    const cr = r2b.rankOf.get(w), cd = r2b.distOf[cr - 1];
    if (!it || it.r !== cr || it.d !== cd) { gbad++; fail(`api/guess ${w}: ${JSON.stringify(it)} vs r=${cr} d=${cd}`); }
  });
  if (!gbad) ok('api/guess via HTTP matches client ranks');

  const rHint = await handle(ctx(base + '/api/hint', { t: jNew.t, r: 7 }), 'hint');
  const jHint = await rHint.json();
  if (jHint.word !== r2b.wordAt[6] || jHint.d !== r2b.distOf[6]) fail(`api/hint r=7: ${JSON.stringify(jHint)} vs ${r2b.wordAt[6]}`);
  else ok('api/hint r=7 matches client');

  const rBad = await handle(ctx(base + '/api/guess', { t: 'garbage', words: ['x'] }), 'guess');
  if (rBad.status !== 400) fail('bad token accepted'); else ok('bad token rejected');

  // /api/def over HTTP (GET)
  const someWord = P.WORDS.find((w) => /^[a-z]{4,8}$/.test(w)) || P.WORDS[0];
  const rDef = await handle({ request: new Request(base + '/api/def?lang=' + L + '&word=' + encodeURIComponent(someWord.toLowerCase())), env: fakeEnv }, 'def');
  const jDef = await rDef.json();
  if (jDef.entry) ok(`api/def returned an entry for "${someWord}"`); else console.log(`  note api/def miss for "${someWord}" (dict may not cover it)`);
  const rDefMiss = await handle({ request: new Request(base + '/api/def?lang=' + L + '&word=zzzzqqq'), env: fakeEnv }, 'def');
  const jDefMiss = await rDefMiss.json();
  if (jDefMiss.entry === null) ok('api/def miss -> entry:null'); else fail('api/def miss shape: ' + JSON.stringify(jDefMiss));

  // daily challenge: (lang, date) -> word must match the client-side reference (pool + rng)
  for (const date of ['2026-10-15', '2027-01-01']) {
    const refPool = [];
    const maxLv = LV_COUNTS[L] - 1;
    for (let i = 0; i < P.N; i++) {
      const l = P.LVIDX[i], w = P.WORDS[i];
      if (l >= 0 && l <= maxLv && (L !== 'en' || (!DAILY_STOP.has(w) && !DAILY_BLOCKED.some((b) => w.startsWith(b))))) refPool.push(w);
    }
    const refWord = refPool[Math.floor(rngRef(`gw-daily-v1|${L}|${date}`)() * refPool.length)];
    const rD = await handle(ctx(base + '/api/new', { lang: L, lo: 0, hi: 5, daily: date }), 'new');
    const jD = await rD.json();
    const rDH = await handle(ctx(base + '/api/hint', { t: jD.t, r: 1 }), 'hint');
    const jDH = await rDH.json();
    if (jD.pool !== refPool.length) fail(`daily pool ${jD.pool} vs ref ${refPool.length} (${L} ${date})`);
    else if (jDH.word !== refWord) fail(`daily word "${jDH.word}" vs ref "${refWord}" (${L} ${date})`);
    else ok(`daily ${date}: "${jDH.word}" (pool ${jD.pool}, matches client ref)`);
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PARITY CHECKS PASSED');
process.exit(failures ? 1 : 0);
