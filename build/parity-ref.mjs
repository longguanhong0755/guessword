// build/parity-ref.mjs — shared client-side reference for the parity tests.
// A verbatim port of js/app.js (decodePack + buildRanks over the rank pool,
// including the deterministic 1e-6 tie-break jitter). Both test-rank-parity.mjs
// (local, drives the engine module over site/) and test-rank-parity-remote.mjs
// (live HTTP, fetches the deployed data) compare against this one
// implementation, so the evidence is consistent.
import { isStopWord, isBlocked } from '../functions/api/_pool-stopwords.js';

export const LV_COUNTS = { en: 6, ja: 5, ko: 6, fr: 6, de: 6, es: 6 };

// same predicate as js/app.js poolOk() / functions/api/_engine.js poolOk()
export function poolOkRef(lang, word) {
  return !isStopWord(lang, word) && !(lang === 'en' && isBlocked(word));
}

export function rngRef(seedStr) {
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

// meta: as in data/gw-<L>-meta.json ({N,D,words,level,min,max}); vecBytes: raw int8 chunks concatenated
export function decodePack(meta, vecBytes) {
  const D2 = meta.D, N2 = meta.N;
  const words = meta.words.split("|");
  const unit = new Float32Array(N2 * D2);
  const min = meta.min, max = meta.max;
  for (let i = 0; i < N2; i++) for (let d = 0; d < D2; d++) unit[i * D2 + d] = min[d] + (vecBytes[i * D2 + d] / 255) * (max[d] - min[d]);
  for (let i = 0; i < N2; i++) {
    let n2 = 0;
    for (let d = 0; d < D2; d++) { const v = unit[i * D2 + d]; n2 += v * v; }
    const inv = 1 / Math.sqrt(n2) || 0;
    for (let d = 0; d < D2; d++) unit[i * D2 + d] *= inv;
  }
  const lv = new Uint8Array(meta.level.length);
  for (let i = 0; i < lv.length; i++) lv[i] = +meta.level[i];
  return { D: D2, N: N2, WORDS: words, LVIDX: lv, UNIT: unit, IDX: new Map(words.map((w, i) => [w, i])) };
}

// verbatim buildRanks(): scores = cos + rng(lang|secret|word) * 1e-6, then
// rank within the graded, non-function-word pool (score desc, word asc).
// Non-pool words are ranked by insertion into that order.
export function buildRanksRef(P, secretWord, lang) {
  const P_D = P.D, P_N = P.N, P_W = P.WORDS, P_U = P.UNIT;
  const si = P.IDX.get(secretWord);
  if (si === undefined || !P_U) return null;
  const scores = new Float64Array(P_N);
  for (let i = 0; i < P_N; i++) {
    if (i === si) { scores[i] = 2; continue; }
    let dot = 0, off = i * P_D, soff = si * P_D;
    for (let d = 0; d < P_D; d++) dot += P_U[off + d] * P_U[soff + d];
    scores[i] = dot + rngRef(lang + "|" + secretWord + "|" + P_W[i])() * 1e-6;
  }
  const nLv = LV_COUNTS[lang] || 6;
  const mask = new Uint8Array(P_N), pool = [];
  for (let i = 0; i < P_N; i++) {
    const l = P.LVIDX[i];
    if (l >= 0 && l < nLv && poolOkRef(lang, P_W[i])) { mask[i] = 1; pool.push(i); }
  }
  const poolN = pool.length;
  const order = new Array(poolN);
  for (let k = 0; k < poolN; k++) order[k] = pool[k];
  order.sort((a, b) => scores[b] - scores[a] || (P_W[a] < P_W[b] ? -1 : (P_W[a] > P_W[b] ? 1 : 0)));
  const rankOf = new Map(), wordAt = new Array(poolN);
  for (let k = 0; k < poolN; k++) {
    const i = order[k];
    rankOf.set(P_W[i], k + 1);
    wordAt[k] = P_W[i];
  }
  for (let i = 0; i < P_N; i++) {
    if (mask[i]) continue;
    const s = scores[i], w = P_W[i];
    let lo = 0, hi = poolN;
    while (lo < hi) {
      const mid = (lo + hi) >> 1, j = order[mid];
      if (scores[j] > s || (scores[j] === s && P_W[j] < w)) lo = mid + 1; else hi = mid;
    }
    // rank 1 is reserved for the secret (see js/app.js / _engine.js)
    rankOf.set(w, w === secretWord ? 1 : Math.max(2, lo + 1));
  }
  // a legacy save may carry a secret outside the pool: rank 1 stays unique
  if (poolN && !mask[si]) { rankOf.set(P_W[order[0]], 2); wordAt[0] = secretWord; }
  const distOf = new Array(poolN + 1);
  for (let r = 0; r <= poolN; r++) distOf[r] = r + 1;
  return { rankOf, wordAt, distOf, N: poolN, poolN, lang, pool, mask };
}
