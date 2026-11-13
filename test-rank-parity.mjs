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

  // POOL: server and client must select the same graded, non-function words.
  // LEGAL: the same non-function word set (level 9 included) in the same order.
  const ref0Secret = P.WORDS.find((w, i) => P.LVIDX[i] >= 0 && P.LVIDX[i] < LV_COUNTS[L] && poolOkRef(L, w));
  const ref0 = buildRanksRef(P, ref0Secret, L);
  if (!ref0) { fail('reference build failed'); continue; }
  if (S.POOL_N !== ref0.poolN) fail(`pool size ${S.POOL_N} vs ref ${ref0.poolN}`);
  else ok(`pool size identical (${S.POOL_N} words)`);
  let poolSame = S.POOL.length === ref0.pool.length;
  if (poolSame) for (let k = 0; k < S.POOL.length; k++) if (S.POOL[k] !== ref0.pool[k]) { poolSame = false; console.log('   first diff at', k, S.POOL[k], ref0.pool[k]); break; }
  poolSame ? ok('pool index list identical') : fail('pool differs');
  if (S.LEGAL_N !== ref0.N) fail(`legal size ${S.LEGAL_N} vs ref ${ref0.N}`);
  else ok(`legal total-order size identical (${S.LEGAL_N} words)`);
  let legalSame = S.LEGAL.length === ref0.legal.length;
  if (legalSame) for (let k = 0; k < S.LEGAL.length; k++) if (S.LEGAL[k] !== ref0.legal[k]) { legalSame = false; console.log('   first legal diff at', k, S.LEGAL[k], ref0.legal[k]); break; }
  legalSame ? ok('legal index list identical') : fail('legal index list differs');

  // LEGAL is exactly the non-function, non-blocked set; its ranks are a bijection
  let stopN = 0;
  for (let i = 0; i < P.N; i++) if (!poolOkRef(L, P.WORDS[i])) stopN++;
  if (ref0.N !== P.N - stopN) fail(`legal size ${ref0.N} vs N-stopwords ${P.N - stopN}`);
  else ok(`legal size = N - function/blocked words (${P.N} - ${stopN})`);
  {
    let setOk = true, lv9Ok = true;
    for (let i = 0; i < P.N; i++) {
      const legal = !!ref0.legalMask[i];
      if (legal !== poolOkRef(L, P.WORDS[i])) { setOk = false; break; }
      if (P.LVIDX[i] === 9 && legal && !ref0.rankOf.has(P.WORDS[i])) { lv9Ok = false; break; }
    }
    setOk ? ok('LEGAL membership matches the shared predicate') : fail('LEGAL membership differs');
    lv9Ok ? ok('level-9 words are ranked in LEGAL') : fail('level-9 word missing from LEGAL ranks');
    const seen = new Set(ref0.wordAt);
    let bij = ref0.wordAt.length === ref0.N && seen.size === ref0.N && ref0.rankOf.size === ref0.N;
    for (let k = 0; k < ref0.N && bij; k++) if (ref0.rankOf.get(ref0.wordAt[k]) !== k + 1) bij = false;
    bij ? ok(`ranks are a bijection 1..${ref0.N}`) : fail('ranks are not a bijection');
  }

  // fixed regression from the external report: the level-9 synonym chain must
  // be strictly ordered instead of all sharing rank 2
  if (L === 'en') {
    const ri = buildRanksRef(P, 'ingrate', L);
    const want = [['ingrate', 1], ['ungrateful', 2], ['wretch', 3], ['bastard', 4], ['obnoxious', 5], ['arrogant', 6]];
    let bad = 0;
    if (!ri) { bad++; fail('ingrate reference missing'); }
    else for (const [w, r] of want) {
      const got = ri.rankOf.get(w);
      if (got !== r) { bad++; fail(`ingrate/${w}: rank ${got} vs ${r}`); }
    }
    if (!bad) ok('ingrate chain is 1..6 (ungrateful, wretch, bastard, obnoxious, arrogant)');
  }

  // ranks: sample pool secrets x legal words through the engine functions
  // (real secrets always come from POOL; a level-9 secret would not have a
  // poolWordAt[0] entry and cannot exercise hint targeting)
  const secrets = [0, Math.floor(ref0.poolN / 2), ref0.poolN - 1].map((k) => P.WORDS[ref0.pool[k]]);
  for (const secret of secrets) {
    const r2 = buildRanksRef(P, secret, L);
    if (!r2) { fail(`reference build failed for secret "${secret}"`); continue; }
    const pool = Array.from({ length: 300 }, (_, k) => r2.wordAt[Math.floor(k * r2.N / 300)]);
    pool.push(secret, r2.wordAt[0], r2.wordAt[r2.N - 1]);

    // drive the actual engine functions directly
    const si = P.IDX.get(secret);
    const scores = eng.scorePass(S, si, secret);
    let bad = 0;
    for (const w of pool) {
      const wi = P.IDX.get(w);
      const rServer = w === secret ? 1 : eng.rankAt(S, scores, wi);
      const rClient = r2.rankOf.get(w);
      const prServer = eng.poolRankAt(S, scores, wi);
      const prClient = r2.poolRankOf.get(w);
      if (rServer !== rClient || prServer !== prClient) {
        bad++;
        if (bad < 4) fail(`${w}: server r=${rServer} pr=${prServer} vs client r=${rClient} pr=${prClient}`);
      }
    }
    if (!bad) ok(`ranks+pr identical for ${pool.length} words (secret "${secret}")`);

    // hint selection: pool ordinal k must match client poolWordAt[k-1]
    let hbad = 0;
    const nPool = r2.poolN;
    const ks = [1, 2, 3, 4, 7, 15, 42, 100, 333, 1000, 2500, Math.floor(nPool / 2), nPool];
    let hchecked = 0;
    for (const k of ks) {
      if (k > nPool) continue;
      hchecked++;
      const wi = k === 1 ? si : eng.indexAtRank(S, scores, k);
      const w = P.WORDS[wi];
      if (w !== r2.poolWordAt[k - 1]) { hbad++; fail(`hint pool rank ${k}: ${w} vs ${r2.poolWordAt[k - 1]}`); }
      if (eng.poolRankAt(S, scores, wi) !== k) { hbad++; fail(`hint pool rank ${k}: server pr=${eng.poolRankAt(S, scores, wi)}`); }
      if (eng.rankAt(S, scores, wi) !== r2.rankOf.get(w)) { hbad++; fail(`hint pool rank ${k}: legal r mismatch`); }
    }
    if (!hbad) ok(`hint pool ordinal -> word/legal rank identical (${hchecked} ranks)`);
  }

  // full HTTP layer: /api/new -> /api/guess -> /api/hint -> /api/def
  const base = 'https://x.test';
  const rNew = await handle(ctx(base + '/api/new', { lang: L, lo: 0, hi: 3, recent: [] }), 'new');
  const jNew = await rNew.json();
  if (!jNew.t) fail('api/new failed: ' + JSON.stringify(jNew));
  else {
    ok('api/new token ok (pool ' + jNew.pool + ')');
    if (jNew.n !== ref0.N) fail(`api/new n=${jNew.n} vs ref legal ${ref0.N}`);
    else ok('api/new reports legal total-order size ' + jNew.n);
  }

  // decode the token by exercising /api/hint pr=1 (the server reveals the secret there)
  const rHint1 = await handle(ctx(base + '/api/hint', { t: jNew.t, pr: 1 }), 'hint');
  const jHint1 = await rHint1.json();
  if (!jHint1.word || jHint1.d !== 1 || jHint1.r !== 1 || jHint1.pr !== 1) fail('api/hint pr=1: ' + JSON.stringify(jHint1));
  else ok('api/hint pr=1 reveals secret "' + jHint1.word + '" with r=1');

  const secret2 = jHint1.word;
  const r2b = buildRanksRef(P, secret2, L);
  const sample = [r2b.wordAt[10], r2b.wordAt[1000], secret2];
  const rGuess = await handle(ctx(base + '/api/guess', { t: jNew.t, words: sample }), 'guess');
  const jGuess = await rGuess.json();
  let gbad = 0;
  (jGuess.items || []).forEach((it, ix) => {
    const w = sample[ix];
    const cr = r2b.rankOf.get(w), cd = r2b.distOf[cr - 1], cp = r2b.poolRankOf.get(w);
    if (!it || it.r !== cr || it.d !== cd || it.pr !== cp) { gbad++; fail(`api/guess ${w}: ${JSON.stringify(it)} vs r=${cr} d=${cd} pr=${cp}`); }
  });
  if (!gbad) ok('api/guess via HTTP matches client legal ranks and pr');

  const rHint = await handle(ctx(base + '/api/hint', { t: jNew.t, pr: 7 }), 'hint');
  const jHint = await rHint.json();
  const hw = jHint.word, hr = r2b.rankOf.get(hw), hp = 7;
  if (hw !== r2b.poolWordAt[6] || jHint.r !== hr || jHint.d !== hr || jHint.pr !== hp) {
    fail(`api/hint pr=7: ${JSON.stringify(jHint)} vs ${r2b.poolWordAt[6]} r=${hr} pr=${hp}`);
  } else ok('api/hint pr=7 matches client (displayed legal rank ' + hr + ')');
  if (jHint.n !== r2b.N) fail(`api/hint n=${jHint.n} vs ref ${r2b.N}`);
  else ok('api/hint reports legal total-order size ' + jHint.n);
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
