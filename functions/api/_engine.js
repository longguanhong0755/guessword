/* =====================================================================
   GuessWord online engine — Cloudflare Pages Function shared module.

   The semantic ranking runs here so browsers never download the vector
   banks (per language: ~6-10MB of quantized Numberbatch vectors). The
   client only fetches a lightweight word list (words + levels) for
   autocomplete/validation, and one small request per guess.

   The ranking math is a 1:1 port of buildRanks() in js/app.js, including
   the deterministic per-word tie-break jitter, so ranks and distances are
   identical to the offline build (verified by test/test-rank-parity.mjs).

   Routes (wired by sibling files new.js / guess.js / hint.js / def.js):
     POST /api/new    {lang, lo, hi, recent[]}  -> {t: token}
     POST /api/guess  {t, words[]}              -> {items: [{r, d} | null]}
     POST /api/hint   {t, r}                    -> {word, d}
     GET  /api/def    ?lang=&word=              -> {entry | null}

   The token carries the secret encrypted (AES-GCM), so the answer never
   reaches the browser before the game ends, and no server-side session
   storage is needed.
   ===================================================================== */
"use strict";

export const VER = "__GW_VER__";   // injected by build-variant.mjs; busts asset caches

const LANGS = ["en", "ja", "ko", "fr", "de", "es"];
const LV_COUNT = { en: 6, ja: 5, ko: 6, fr: 6, de: 6, es: 6 };
const CHUNK_LIMIT = 64 * 1024 * 1024;      // sanity cap for vec assets

/* ---------- byte / json helpers ---------- */
const te = new TextEncoder(), td = new TextDecoder();

function b64u(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
async function gunzip(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/* ---------- deterministic PRNG (port of js/app.js rng) ---------- */
function rng(seedStr) {
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

/* ---------- language state (int8 vectors -> normalized float32) ---------- */
function decodeUnit(N, D, bytes, min, max) {
  const unit = new Float32Array(N * D);
  for (let i = 0; i < N; i++) for (let d = 0; d < D; d++) unit[i * D + d] = min[d] + (bytes[i * D + d] / 255) * (max[d] - min[d]);
  for (let i = 0; i < N; i++) {
    let n2 = 0;
    for (let d = 0; d < D; d++) { const v = unit[i * D + d]; n2 += v * v; }
    const inv = 1 / Math.sqrt(n2) || 0;
    for (let d = 0; d < D; d++) unit[i * D + d] *= inv;
  }
  return unit;
}
function distTable(N) {
  const K = 3000 / N, out = new Int32Array(N);
  let prev = 0;
  for (let r = 0; r < N; r++) { const d = Math.max(prev + 1, 1 + Math.round(r * K)); out[r] = d; prev = d; }
  return out;
}

const STATE = { langs: new Map(), buckets: new Map() };  // per-isolate caches

export function createEngine(fetchAsset) {
  const langs = STATE.langs;         // lang -> state (LRU, byte-budgeted)
  const dictBuckets = STATE.buckets; // "lang:bucket" -> parsed bucket object (LRU)

  function evict() {
    let total = 0;
    for (const st of langs.values()) total += st.UNIT.byteLength;
    while (langs.size && (langs.size > 2 || total > 80 * 1024 * 1024)) {
      const k = langs.keys().next().value;
      total -= langs.get(k).UNIT.byteLength;
      langs.delete(k);
    }
    while (dictBuckets.size > 24) dictBuckets.delete(dictBuckets.keys().next().value);
  }

  async function loadLang(L) {
    if (langs.has(L)) { const v = langs.get(L); langs.delete(L); langs.set(L, v); return v; }
    const meta = JSON.parse(td.decode(await fetchAsset(`/data/gw-${L}-meta.json?v=${VER}`)));
    const parts = await Promise.all(Array.from({ length: meta.chunks }, (_, i) => fetchAsset(`/data/gw-${L}-vec-${i}.bin?v=${VER}`)));
    let total = 0;
    for (const p of parts) total += p.byteLength;
    if (total !== meta.N * meta.D || total > CHUNK_LIMIT) throw new Error(`bad vec size for ${L}`);
    const vec = new Uint8Array(total);
    { let off = 0; for (const p of parts) { vec.set(p, off); off += p.byteLength; } }
    const words = meta.words.split("|");
    const lv = new Uint8Array(meta.level.length);
    for (let i = 0; i < lv.length; i++) lv[i] = +meta.level[i];
    const st = {
      L, N: meta.N, D: meta.D, WORDS: words, LVIDX: lv,
      UNIT: decodeUnit(meta.N, meta.D, vec, meta.min, meta.max),
      DIST: distTable(meta.N),
      IDX: new Map(words.map((w, i) => [w, i])),
    };
    langs.set(L, st);
    evict();
    return st;
  }

  // score pass: same math & tie-break jitter as the client (identical results,
  // including Float64 storage — Float32 would round away the 1e-6 tie jitter)
  function scorePass(P, si, secret) {
    const { N, D, UNIT: U, WORDS: W, L } = P;
    const scores = new Float64Array(N);
    const pfx = L + "|" + secret + "|";
    for (let i = 0; i < N; i++) {
      if (i === si) { scores[i] = 2; continue; }
      let dot = 0, off = i * D, soff = si * D;
      for (let d = 0; d < D; d++) dot += U[off + d] * U[soff + d];
      scores[i] = dot + rng(pfx + W[i])() * 1e-6;
    }
    return scores;
  }

  function cmpIdx(scores, W) { return (a, b) => scores[b] - scores[a] || (W[a] < W[b] ? -1 : (W[a] > W[b] ? 1 : 0)); }

  // 1-based rank of word index wi in the (score desc, word asc) order
  function rankAt(P, scores, wi) {
    const sg = scores[wi], W = P.WORDS;
    let r = 1;
    for (let i = 0; i < P.N; i++) {
      const s = scores[i];
      if (s > sg) r++;
      else if (s === sg && W[i] < W[wi]) r++;
    }
    return r;
  }

  // word index sitting at 1-based rank k
  function indexAtRank(P, scores, k) {
    const N = P.N, W = P.WORDS;
    const idx = new Int32Array(N);
    for (let i = 0; i < N; i++) idx[i] = i;
    const cmp = cmpIdx(scores, W);
    let lo = 0, hi = N - 1, target = k - 1;
    while (lo < hi) {
      const pivot = idx[(lo + hi) >> 1];
      let i = lo, j = hi;
      while (i <= j) {
        while (cmp(idx[i], pivot) < 0) i++;
        while (cmp(idx[j], pivot) > 0) j--;
        if (i <= j) { const t = idx[i]; idx[i] = idx[j]; idx[j] = t; i++; j--; }
      }
      if (target <= j) hi = j; else if (target >= i) lo = i; else break;
    }
    return idx[target];
  }

  async function dictEntry(lang, word) {
    const b = fnv1a(word) % 256;
    const key = lang + ":" + b;
    let bucket = dictBuckets.get(key);
    if (bucket) { dictBuckets.delete(key); dictBuckets.set(key, bucket); }
    else {
      const gz = await fetchAsset(`/data/gwdb-${lang}-${b}.bin?v=${VER}`);
      bucket = JSON.parse(td.decode(await gunzip(gz)));
      dictBuckets.set(key, bucket);
      evict();
    }
    return bucket[word] || null;
  }

  return { loadLang, scorePass, rankAt, indexAtRank, dictEntry, langs };
}

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0);
}

/* ---------- token: AES-GCM encrypted {l, lo, hi, s, i} ---------- */
let keyP = null;
function keyOf(secretKey) {
  if (!keyP) keyP = crypto.subtle.digest("SHA-256", te.encode(secretKey))
    .then((raw) => crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]))
    .catch(() => null);
  return keyP;
}
async function makeToken(secretKey, payload) {
  const key = await keyOf(secretKey);
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(payload))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0); out.set(ct, iv.length);
  return b64u(out);
}
async function readToken(secretKey, token) {
  try {
    const key = await keyOf(secretKey);
    if (!key || typeof token !== "string" || token.length > 4096) return null;
    const raw = unb64u(token);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12) }, key, raw.subarray(12));
    const p = JSON.parse(td.decode(pt));
    if (!LANGS.includes(p.l) || typeof p.s !== "string") return null;
    return p;
  } catch (e) { return null; }
}

/* ---------- request bodies ---------- */
async function body(req) {
  try {
    const t = await req.text();
    if (t.length > 200000) return null;
    return JSON.parse(t);
  } catch (e) { return null; }
}

const DEFAULT_KEY = "guessword-2026-online-engine-v1";

/* ---------- route handlers ---------- */
export async function handle(context, kind) {
  const { request, env } = context;
  const key = (env && env.GW_KEY) || DEFAULT_KEY;
  const eng = createEngine((p) => fetchAssetVia(env, request, p));

  try {
    if (kind === "new") {
      if (request.method !== "POST") return json({ err: "method" }, 405);
      const b = await body(request);
      if (!b || !LANGS.includes(b.lang)) return json({ err: "bad request" }, 400);
      const lo = Math.max(0, Math.min(LV_COUNT[b.lang] - 1, b.lo | 0));
      const hi = Math.max(lo, Math.min(LV_COUNT[b.lang] - 1, b.hi | 0));
      const P = await eng.loadLang(b.lang);
      const pool = [];
      for (let i = 0; i < P.N; i++) if (P.LVIDX[i] >= lo && P.LVIDX[i] <= hi) pool.push(i);
      if (!pool.length) return json({ err: "empty pool" }, 400);
      const recent = new Set(Array.isArray(b.recent) ? b.recent.slice(-160).filter((w) => typeof w === "string") : []);
      const fresh = pool.filter((i) => !recent.has(P.WORDS[i]));
      const use = fresh.length > 30 ? fresh : pool;
      const si = use[Math.floor(Math.random() * use.length)];
      const t = await makeToken(key, { l: b.lang, lo, hi, s: P.WORDS[si], i: Date.now() });
      if (!t) return json({ err: "token" }, 500);
      return json({ t, pool: pool.length });
    }

    if (kind === "guess") {
      if (request.method !== "POST") return json({ err: "method" }, 405);
      const b = await body(request);
      const p = b && await readToken(key, b.t);
      if (!p) return json({ err: "bad token" }, 400);
      const words = Array.isArray(b.words) ? b.words.slice(0, 50).filter((w) => typeof w === "string") : [];
      if (!words.length) return json({ err: "no words" }, 400);
      const P = await eng.loadLang(p.l);
      const si = P.IDX.get(p.s);
      if (si === undefined) return json({ err: "secret gone" }, 500);
      const scores = eng.scorePass(P, si, p.s);
      const items = words.map((w) => {
        const wi = P.IDX.get(w);
        if (wi === undefined) return null;
        const r = wi === si ? 1 : eng.rankAt(P, scores, wi);
        return { r, d: P.DIST[r - 1] };
      });
      return json({ items });
    }

    if (kind === "hint") {
      if (request.method !== "POST") return json({ err: "method" }, 405);
      const b = await body(request);
      const p = b && await readToken(key, b.t);
      if (!p) return json({ err: "bad token" }, 400);
      const P = await eng.loadLang(p.l);
      const si = P.IDX.get(p.s);
      if (si === undefined) return json({ err: "secret gone" }, 500);
      let r = b.r | 0;
      if (!(r >= 1 && r <= P.N)) return json({ err: "bad rank" }, 400);
      const scores = eng.scorePass(P, si, p.s);
      const wi = r === 1 ? si : eng.indexAtRank(P, scores, r);
      const rr = wi === si ? 1 : eng.rankAt(P, scores, wi);
      return json({ word: P.WORDS[wi], r: rr, d: P.DIST[rr - 1] });
    }

    if (kind === "def") {
      const u = new URL(request.url);
      const lang = u.searchParams.get("lang") || "";
      const word = (u.searchParams.get("word") || "").toLowerCase();
      if (!LANGS.includes(lang) || !word || word.length > 60) return json({ err: "bad request" }, 400);
      const entry = await eng.dictEntry(lang, word);
      return json({ entry });
    }

    return json({ err: "not found" }, 404);
  } catch (e) {
    return json({ err: "engine error", msg: String((e && e.message) || e) }, 500);
  }
}

function fetchAssetVia(env, request, path) {
  const url = new URL(path, request.url);
  if (env && env.ASSETS && typeof env.ASSETS.fetch === "function") {
    return env.ASSETS.fetch(new Request(url.toString())).then((r) => {
      if (!r.ok) throw new Error(`asset ${path}: HTTP ${r.status}`);
      return r.arrayBuffer().then((b) => new Uint8Array(b));
    });
  }
  // local `wrangler pages dev` without ASSETS binding: same-origin fetch
  return fetch(url.toString()).then((r) => {
    if (!r.ok) throw new Error(`asset ${path}: HTTP ${r.status}`);
    return r.arrayBuffer().then((b) => new Uint8Array(b));
  });
}
