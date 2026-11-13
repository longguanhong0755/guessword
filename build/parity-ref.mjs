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

// verbatim buildRanks(): scores = cos + rng(lang|secret|word) * 1e-6, then a
// single total order over every legal guess (LEGAL: non-function, non-blocked,
// level 9 included). The secret is rank 1 (its score is pinned to 2.0).
//
// POOL (graded + legal) is still the only source of secrets and hints. Its
// ordinal/bucket rank is kept separately as poolRankOf/poolWordAt so hint
// targeting can stay on the graded vocabulary while the UI displays the legal
// rank. For a pool word pr is its pool position; for a non-pool word pr is
// the bucket number (1 + #pool words above), which is only used internally.
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
  const poolMask = new Uint8Array(P_N), pool = [];
  const legalMask = new Uint8Array(P_N), legal = [];
  for (let i = 0; i < P_N; i++) {
    const w = P_W[i];
    if (!poolOkRef(lang, w)) continue;
    legalMask[i] = 1; legal.push(i);
    const l = P.LVIDX[i];
    if (l >= 0 && l < nLv) { poolMask[i] = 1; pool.push(i); }
  }
  const poolN = pool.length, legalN = legal.length;
  // a secret outside LEGAL (legacy save: a function word / removed entry) has
  // no rank in the new scale; callers restart instead of mixing scales.
  if (!legalMask[si]) return null;

  const order = new Array(legalN);
  for (let k = 0; k < legalN; k++) order[k] = legal[k];
  order.sort((a, b) => scores[b] - scores[a] || (P_W[a] < P_W[b] ? -1 : (P_W[a] > P_W[b] ? 1 : 0)));

  const rankOf = new Map(), wordAt = new Array(legalN);
  const poolRankOf = new Map(), poolWordAt = new Array(poolN);
  let poolSeen = 0;
  for (let k = 0; k < legalN; k++) {
    const i = order[k], w = P_W[i];
    rankOf.set(w, k + 1);
    wordAt[k] = w;
    poolRankOf.set(w, poolSeen + 1);
    if (poolMask[i]) poolWordAt[poolSeen++] = w;
  }
  const distOf = new Array(legalN);
  for (let r = 0; r < legalN; r++) distOf[r] = r + 1;
  return { rankOf, wordAt, distOf, N: legalN, poolN, lang, pool, mask: poolMask, legal, legalMask, poolRankOf, poolWordAt };
}
