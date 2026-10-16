// build/parity-ref.mjs — shared client-side reference for the parity tests.
// A verbatim port of js/app.js (decodePack + buildRanks, including the deterministic
// 1e-6 tie-break jitter). Both test-rank-parity.mjs (local, drives the engine module
// over site/) and test-rank-parity-remote.mjs (live HTTP, fetches the deployed data)
// compare against this one implementation, so the evidence is consistent.
export const LV_COUNTS = { en: 6, ja: 5, ko: 6, fr: 6, de: 6, es: 6 };

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

// verbatim buildRanks(): scores = cos + rng(lang|secret|word) * 1e-6, order = score desc, word asc
export function buildRanksRef(P, secretWord, lang) {
  const P_D = P.D, P_N = P.N, P_W = P.WORDS, P_U = P.UNIT;
  const si = P.IDX.get(secretWord);
  if (si === undefined) return null;
  const scores = new Float64Array(P_N);
  for (let i = 0; i < P_N; i++) {
    if (i === si) { scores[i] = 2; continue; }
    let dot = 0, off = i * P_D, soff = si * P_D;
    for (let d = 0; d < P_D; d++) dot += P_U[off + d] * P_U[soff + d];
    scores[i] = dot + rngRef(lang + "|" + secretWord + "|" + P_W[i])() * 1e-6;
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
