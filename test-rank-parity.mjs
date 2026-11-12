/* =====================================================================
   Rank parity test: the online engine (functions/api/_engine.js, driven
   here through its real HTTP handlers) must produce exactly the same
   ranks and distances as the client-side buildRanks() in js/app.js.

   Usage: node test-rank-parity.mjs            (uses site/ built by build-variant.mjs)
          node test-rank-parity.mjs en ja fr
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { LV_COUNTS, rngRef, decodePack, buildRanksRef, poolOkRef } from './build/parity-ref.mjs';
import { clientStopwords } from './build/sync-stopwords.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SITE = process.env.GW_SITE || path.join(ROOT, 'site');
const LANGS = process.argv.slice(2).length ? process.argv.slice(2) : ['en', 'ja', 'fr'];

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

/* ---------- client-side reference (verbatim port; shared in build/parity-ref.mjs) ---------- */
function clientPack(L) {
  const meta = JSON.parse(fs.readFileSync(path.join(SITE, 'data', `gw-${L}-meta.json`), 'utf8'));
  const parts = [];
  for (let i = 0; i < meta.chunks; i++) parts.push(fs.readFileSync(path.join(SITE, 'data', `gw-${L}-vec-${i}.bin`)));
  return decodePack(meta, new Uint8Array(Buffer.concat(parts)));
}

/* ---------- checks ---------- */
let failures = 0;
const fail = (m) => { failures++; console.log('  FAIL ' + m); };
const ok = (m) => console.log('  ok   ' + m);

const ENGINE_URL = pathToFileURL(path.join(SITE, 'functions', 'api', '_engine.js')).href;
const { handle, createEngine } = await import(ENGINE_URL);

// the split dev build loads js/pool-stopwords.js as a classic script; it must
// be generated from the same shared module the deploy build inlines
{
  let dev = '';
  try { dev = fs.readFileSync(path.join(ROOT, 'js', 'pool-stopwords.js'), 'utf8'); } catch (e) { /* missing */ }
  if (dev !== clientStopwords()) fail('js/pool-stopwords.js is out of sync (run node build/sync-stopwords.mjs)');
  else ok('split-dev stopword copy in sync with the shared module');
}

for (const L of LANGS) {
  console.log(`\n=== ${L} ===`);
  const P = clientPack(L);
  const eng = createEngine((p) => Promise.resolve(assetBytes(p)));
  const S = await eng.loadLang(L);

  console.log(`N=${P.N} D=${P.D} words=${P.WORDS.length}`);
  if (S.N !== P.N || S.D !== P.D) fail('N/D mismatch');

  // unit matrices must be bit-identical
  let same = S.UNIT.length === P.UNIT.length;
  if (same) for (let i = 0; i < S.UNIT.length; i++) if (S.UNIT[i] !== P.UNIT[i]) { same = false; console.log('   first diff at', i, S.UNIT[i], P.UNIT[i]); break; }
  same ? ok('unit matrix bit-identical') : fail('unit matrix differs');

  // rank pool: server and client must select the same graded, non-function words
  const ref0 = buildRanksRef(P, P.WORDS[0], L);
  if (S.POOL_N !== ref0.N) fail(`pool size ${S.POOL_N} vs ref ${ref0.N}`);
  else ok(`rank pool size identical (${S.POOL_N} words)`);
  let poolSame = S.POOL.length === ref0.pool.length;
  if (poolSame) for (let k = 0; k < S.POOL.length; k++) if (S.POOL[k] !== ref0.pool[k]) { poolSame = false; console.log('   first diff at', k, S.POOL[k], ref0.pool[k]); break; }
  poolSame ? ok('rank pool index list identical') : fail('rank pool differs');

  // regression: a non-pool word that outscores every pool word (typically an
  // ungraded inflected form) must rank 2+, never 1 — rank 1 means "the secret"
  {
    const step = Math.max(1, Math.floor(ref0.pool.length / 12));
    let found = null;
    for (let k = 0; k < ref0.pool.length && !found; k += step) {
      const si = ref0.pool[k], soff = si * P.D;
      let bestAll = -Infinity, biAll = -1, bestPool = -Infinity;
      for (let i = 0; i < P.N; i++) {
        if (i === si) continue;
        let dot = 0, off = i * P.D;
        for (let d = 0; d < P.D; d++) dot += P.UNIT[off + d] * P.UNIT[soff + d];
        if (dot > bestAll) { bestAll = dot; biAll = i; }
        if (ref0.mask[i] && dot > bestPool) bestPool = dot;
      }
      if (biAll >= 0 && !ref0.mask[biAll] && bestAll > bestPool) found = { si, biAll, secret: P.WORDS[si], variant: P.WORDS[biAll] };
    }
    if (!found) ok('no non-pool global argmax in the sampled secrets');
    else {
      const refS = buildRanksRef(P, found.secret, L);
      const sc = eng.scorePass(S, found.si, found.secret);
      const rRef = refS.rankOf.get(found.variant), rSrv = eng.rankAt(S, sc, P.IDX.get(found.variant));
      if (rRef < 2 || rSrv < 2) fail(`non-pool top word "${found.variant}" (for "${found.secret}") ranks ref=${rRef} srv=${rSrv}; rank 1 would fake a win`);
      else ok(`non-pool top word "${found.variant}" capped at rank ${rSrv} (secret "${found.secret}")`);
      if (refS.rankOf.get(found.secret) !== 1) fail(`secret "${found.secret}" does not own rank 1 in ref`);
    }
  }

  // ranks: sample secrets x sample words through the real handlers
  const secrets = [P.WORDS[3], P.WORDS[Math.floor(P.N / 2)], P.WORDS[P.N - 5]];
  for (const secret of secrets) {
    const r2 = buildRanksRef(P, secret, L);
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
      const dServer = rServer, dClient = rClient;
      if (rServer !== rClient || dServer !== dClient) { bad++; if (bad < 4) fail(`${w}: server r=${rServer} d=${dServer} vs client r=${rClient} d=${dClient}`); }
    }
    if (!bad) ok(`ranks identical for ${pool.length} words (secret "${secret}")`);

    // hint selection: word at rank k must match client wordAt[k-1]
    let hbad = 0;
    const nPool = r2.N;
    const ks = [1, 2, 3, 4, 7, 15, 42, 100, 333, 1000, 2500, Math.floor(nPool / 2), nPool];
    let hchecked = 0;
    for (const k of ks) {
      if (k > nPool) continue;
      hchecked++;
      const wi = k === 1 ? si : eng.indexAtRank(S, scores, k);
      const w = P.WORDS[wi];
      if (w !== r2.wordAt[k - 1]) { hbad++; fail(`hint rank ${k}: ${w} vs ${r2.wordAt[k - 1]}`); }
    }
    if (!hbad) ok(`hint rank -> word identical (${hchecked} ranks)`);
  }

  // full HTTP layer: /api/new -> /api/guess -> /api/hint -> /api/def
  const base = 'https://x.test';
  const rNew = await handle(ctx(base + '/api/new', { lang: L, lo: 0, hi: 3, recent: [] }), 'new');
  const jNew = await rNew.json();
  if (!jNew.t) fail('api/new failed: ' + JSON.stringify(jNew));
  else {
    ok('api/new token ok (pool ' + jNew.pool + ')');
    if (jNew.n !== ref0.N) fail(`api/new n=${jNew.n} vs ref pool ${ref0.N}`);
    else ok('api/new reports rank-pool size ' + jNew.n);
  }

  // decode the token by exercising /api/hint r=1 (the server reveals the secret there)
  const rHint1 = await handle(ctx(base + '/api/hint', { t: jNew.t, r: 1 }), 'hint');
  const jHint1 = await rHint1.json();
  if (!jHint1.word || jHint1.d !== 1) fail('api/hint r=1: ' + JSON.stringify(jHint1)); else ok('api/hint r=1 reveals secret "' + jHint1.word + '"');

  const secret2 = jHint1.word;
  const r2b = buildRanksRef(P, secret2, L);
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
  if (jHint.word !== r2b.wordAt[6] || jHint.d !== r2b.distOf[6]) fail(`api/hint r=7: ${JSON.stringify(jHint)} vs ${r2b.wordAt[6]} d=${r2b.distOf[6]}`);
  else ok('api/hint r=7 matches client');
  if (jHint.n !== r2b.N) fail(`api/hint n=${jHint.n} vs ref ${r2b.N}`);
  else ok('api/hint reports rank-pool size ' + jHint.n);
  if (!poolOkRef(L, jHint.word)) fail(`api/hint returned function/blocked word "${jHint.word}"`);
  else ok('api/hint word is an eligible pool word');
  const wiHint = P.IDX.get(jHint.word);
  if (wiHint === undefined || !(P.LVIDX[wiHint] >= 0 && P.LVIDX[wiHint] < LV_COUNTS[L])) fail(`api/hint returned ungraded/unknown word "${jHint.word}"`);
  else ok('api/hint word is graded');

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
      if (l >= 0 && l <= maxLv && poolOkRef(L, w)) refPool.push(w);
    }
    const refWord = refPool[Math.floor(rngRef(`gw-daily-v1|${L}|${date}`)() * refPool.length)];
    const rD = await handle(ctx(base + '/api/new', { lang: L, lo: 0, hi: 5, daily: date }), 'new');
    const jD = await rD.json();
    const rDH = await handle(ctx(base + '/api/hint', { t: jD.t, r: 1 }), 'hint');
    const jDH = await rDH.json();
    if (jD.pool !== refPool.length) fail(`daily pool ${jD.pool} vs ref ${refPool.length} (${L} ${date})`);
    else if (jD.n !== ref0.N) fail(`daily n=${jD.n} vs ref rank pool ${ref0.N} (${L} ${date})`);
    else if (jDH.word !== refWord) fail(`daily word "${jDH.word}" vs ref "${refWord}" (${L} ${date})`);
    else ok(`daily ${date}: "${jDH.word}" (pool ${jD.pool}, n ${jD.n}, matches client ref)`);
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PARITY CHECKS PASSED');
process.exit(failures ? 1 : 0);
