"use strict";
/* =====================================================================
   GuessWord — offline multilingual word-guessing game.
   Languages: English (Oxford CEFR), Japanese (JLPT N5-N1), Korean (Yonsei 1-6),
   French / German / Spanish (frequency bands). Semantic ranking via ConceptNet
   Numberbatch 19.08 (CC BY-SA 4.0) 300-d vectors, int8-quantized, decoded and
   ranked locally in this file. Distance 1 = the secret word.
   ===================================================================== */
/* CEFR vocab + Numberbatch 300d int8-quantized — generated locally */

/* ---------- language packs ---------- */
const LANGS = {
  en:{ name:"English",  cn:"英文", badge:"CEFR",  levels:["A1","A2","B1","B2","C1","C2"], chars:/^[a-z]+$/ },
  ja:{ name:"日本語",   cn:"日文", badge:"JLPT",  levels:["N5","N4","N3","N2","N1"], chars:/^[\u3040-\u30ff\u4e00-\u9fff\u3005\u30fc\uff66-\uff9fー]+$/ },
  ko:{ name:"한국어",   cn:"韩文", badge:"延世",  levels:["延世1","延世2","延世3","延世4","延世5","延世6"], chars:/^[\uac00-\ud7a3]+$/ },
  fr:{ name:"Français", cn:"法文", badge:"词频",  levels:["频段1","频段2","频段3","频段4","频段5","频段6"], chars:/^[a-zàâäéèêëîïôöùûüÿçœæ]+$/ },
  de:{ name:"Deutsch",  cn:"德文", badge:"词频",  levels:["频段1","频段2","频段3","频段4","频段5","频段6"], chars:/^[a-zäöüß]+$/ },
  es:{ name:"Español",  cn:"西班牙文", badge:"词频", levels:["频段1","频段2","频段3","频段4","频段5","频段6"], chars:/^[a-záéíóúüñ]+$/ },
};
function langCn(){ try{ return LANGS[LANG].cn || "英文"; }catch(e){ return "英文"; } }
function phText(){ return "输入一个" + langCn() + "单词"; }
/* ---------- online engine (deploy build: ranking + dictionary served by /api) ---------- */
let REMOTE = false;      // set during boot when the deploy loader is present (window.__gwRemote)
let gameToken = null;    // remote game handle — the secret stays server-side, encrypted inside it
let pendingNew = null;   // in-flight /api/new for the current game (the player may type while it loads)
function apiURL(path){ return (window.__gwAPI || "/api") + path; }
// one retry on network hiccups / 5xx (the China route to the edge is occasionally lossy)
function apiPost(path, data, tries){
  const left0 = tries || 2;
  return new Promise((resolve, reject) => {
    const run = (left) => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 10000);
      fetch(apiURL(path), { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(data || {}), signal: ctl.signal })
        .then(r => { clearTimeout(timer); if(!r.ok){ const e = new Error("HTTP "+r.status); e.http = r.status; throw e; } return r.json(); })
        .then(j => { if(j && j.err) throw new Error(j.err); resolve(j); })
        .catch(e => {
          clearTimeout(timer);
          const retriable = !e.http || e.http >= 500;
          if(left > 1 && retriable) run(left - 1); else reject(e);
        });
    };
    run(left0);
  });
}
// preload a language on the server (fire and forget): the first guess of a
// game then skips the vector decode on a cold isolate
const WARMED = {};
function warmLang(lang){
  if(!REMOTE) return;
  lang = lang || LANG;
  if(WARMED[lang] && Date.now() - WARMED[lang] < 8*60*1000) return;   // don't stack heavy warms
  WARMED[lang] = Date.now();
  try{ apiPost("/warm", { lang }).catch(()=>{}); }catch(e){}
}
const PACK_SRC = { en:()=>GWD, ja:()=>GW_JA, ko:()=>GW_KO, fr:()=>GW_FR, de:()=>GW_DE, es:()=>GW_ES };
const PACK_MAP = { en:()=>GWMAP };
const DICT_SRC = { en:()=>GWDICT_B64, ja:()=>GWDICT_JA_B64, ko:()=>GWDICT_KO_B64, fr:()=>GWDICT_FR_B64, de:()=>GWDICT_DE_B64, es:()=>GWDICT_ES_B64 };
function decodePack(src, mapStr){
  const D2 = src.D, N2 = src.N;
  const words = src.words.split("|");
  const lv = src.level.split("").map(c => +c);
  // src without .vec = lightweight word list (online mode: vectors stay server-side)
  let unit = null;
  if(src.vec){
    let bytes;
    if(typeof src.vec === "string"){
      const b64 = atob(src.vec);
      bytes = new Uint8Array(b64.length);
      for(let i=0;i<b64.length;i++) bytes[i] = b64.charCodeAt(i);
    } else {
      bytes = src.vec;
    }
    unit = new Float32Array(N2*D2);
    const min = src.min, max = src.max;
    for(let i=0;i<N2;i++) for(let d=0;d<D2;d++) unit[i*D2+d] = min[d] + (bytes[i*D2+d]/255)*(max[d]-min[d]);
    // normalize rows to unit length so cosine = dot product
    for(let i=0;i<N2;i++){
      let n2 = 0;
      for(let d=0;d<D2;d++){ const v=unit[i*D2+d]; n2 += v*v; }
      const inv = 1/Math.sqrt(n2) || 0;
      for(let d=0;d<D2;d++) unit[i*D2+d] *= inv;
    }
  }
  return { D:D2, N:N2, WORDS:words, LVIDX:lv, UNIT:unit,
           IDX:new Map(words.map((w,i)=>[w,i])),
           LEMMA: mapStr ? new Map(mapStr.split(";").map(p=>p.split(":"))) : new Map() };
}
const packCache = {};
function getPack(lang){
  if(packCache[lang]) return packCache[lang];
  let src = null;
  try{ src = PACK_SRC[lang] ? PACK_SRC[lang]() : null; }catch(e){ src = null; }
  if(!src) return null;
  const mapFn = PACK_MAP[lang];
  let mapStr = "";
  try{ mapStr = mapFn ? (mapFn() || "") : ""; }catch(e){ mapStr = ""; }
  return packCache[lang] = decodePack(src, mapStr);
}
function packAvailable(lang){ try{ return !!(PACK_SRC[lang] && PACK_SRC[lang]()); }catch(e){ return false; } }
// load a language: online mode fetches only the word list, offline decodes the full vectors
function ensurePack(lang, onProg){
  if(packCache[lang]) return Promise.resolve(packCache[lang]);
  if(REMOTE && window.__loadMeta){
    return window.__loadMeta(lang).then(() => { if(onProg) onProg(1); return getPack(lang); });
  }
  if(window.__loadLang && !packAvailable(lang)){
    return window.__loadLang(lang, onProg).then(() => getPack(lang));
  }
  return Promise.resolve(getPack(lang));
}
const levelsOf = lang => (LANGS[lang] || LANGS.en).levels;
let LANG = "en";
let LEVELS, D, N, WORDS, LVIDX, UNIT, IDX, LEMMA;
function activateLang(lang){
  const p = getPack(lang) || getPack("en");
  LANG = packCache[lang] === p ? lang : "en";
  LEVELS = LANGS[LANG].levels;
  D = p.D; N = p.N; WORDS = p.WORDS; LVIDX = p.LVIDX; UNIT = p.UNIT; IDX = p.IDX; LEMMA = p.LEMMA;
}

/* ---------- state ---------- */
const $ = id => document.getElementById(id);
const LSKEY = "guessword-v2";
const MODEL_VER = "nb1908b";   // embedding model tag; history saved under an older tag gets distances recomputed
let store = { settings:{theme:"dark", sound:true}, history:[], recent:[], games:[], notebook:[] };
try{ const raw = localStorage.getItem(LSKEY); if(raw){ store = Object.assign(store, JSON.parse(raw)); } }catch(e){}
if(!Array.isArray(store.notebook)) store.notebook = [];
if(!Array.isArray(store.games)) store.games = [];
if(typeof store.settings.ac !== "boolean") store.settings.ac = true;
if(!LANGS[store.settings.lang]) store.settings.lang = "en";
function save(){ try{ localStorage.setItem(LSKEY, JSON.stringify(store)); }catch(e){} }
// migrate the old single "current game" slot into the unfinished-games list
if(store.current){
  const c = store.current;
  if(c && c.state==="ongoing" && c.board && c.board.length){
    store.games.push({ gid: Date.now().toString(36)+Math.random().toString(36).slice(2,6), lo:c.lo, hi:c.hi, lang:c.lang||"en",
                       secret:c.secret, board:c.board.map(e=>({word:e.word, isHint:!!e.isHint})), state:"ongoing", at:Date.now() });
  } else if(c && (c.state==="won"||c.state==="lost") && c.secret){
    store.history.push({ lo:c.lo, hi:c.hi, secret:c.secret, state:c.state, lang:c.lang||"en", board:(c.board||[]), at:Date.now(), mv:MODEL_VER });
  }
  delete store.current;
  save();
}
if(store.games.length > 300) store.games.splice(0, store.games.length - 300);
activateLang(store.settings.lang);

let selLo = null, selHi = null;
let cfg = null;
let secret, ranks, board, state, result, marker, hintCount, busy = false, resultsOpen = false;

const fmt = n => n.toLocaleString("en-US");
const cap = w => w.charAt(0).toUpperCase()+w.slice(1);
const rangeLabelFor = (lo, hi, lang) => { const L = levelsOf(lang); return lo===hi ? L[lo] : L[lo]+"–"+L[hi]; };
const rangeLabel = (lo, hi) => rangeLabelFor(lo, hi, LANG);
function rng(seedStr){
  let h=1779033703 ^ seedStr.length;
  for(let i=0;i<seedStr.length;i++){ h=Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = h<<13 | h>>>19; }
  let t = (h=Math.imul(h ^ h>>>16, 2246822507), h=Math.imul(h ^ h>>>13, 3266489909), (h ^= h>>>16)>>>0);
  return function(){ t|=0; t = t + 0x6D2B79F5 | 0; let r = Math.imul(t ^ t>>>15, 1|t); r = r + Math.imul(r ^ r>>>7, 61|r) ^ r; return ((r ^ r>>>14)>>>0)/4294967296; };
}

/* ---------- ranking by cosine similarity ---------- */
const rankCache = {};
function buildRanks(secretWord, lang){
  lang = lang || LANG;
  const key = lang + "|" + secretWord;
  if(rankCache[key]) return rankCache[key];
  const P = getPack(lang);
  if(!P) return null;
  const P_IDX = P.IDX, P_N = P.N, P_D = P.D, P_W = P.WORDS, P_U = P.UNIT;
  const si = P_IDX.get(secretWord);
  if(si === undefined) return null;
  const scores = new Float64Array(P_N);
  for(let i=0;i<P_N;i++){
    if(i===si){ scores[i] = 2; continue; }
    let dot = 0, off = i*P_D, soff = si*P_D;
    for(let d=0;d<P_D;d++) dot += P_U[off+d]*P_U[soff+d];
    scores[i] = dot + rng(lang+"|"+secretWord+"|"+P_W[i])()*1e-6;
  }
  const order = new Array(P_N);
  for(let i=0;i<P_N;i++) order[i]=i;
  order.sort((a,b)=> scores[b]-scores[a] || (P_W[a]<P_W[b]?-1:1));
  const rankOf = new Map(), wordAt = new Array(P_N), distOf = new Array(P_N);
  const K = 3000/P_N;
  let prevDist = 0;
  for(let r=0;r<P_N;r++){
    const i = order[r];
    rankOf.set(P_W[i], r+1);
    wordAt[r] = P_W[i];
    // compress ranks into ~1..3000 while keeping distances unique & monotonic
    const d = Math.max(prevDist+1, 1 + Math.round(r*K));
    distOf[r] = d; prevDist = d;
  }
  return rankCache[key] = { rankOf, wordAt, distOf, N:P_N, K, lang };
}

/* ---------- puzzle pools: selected level + the one below ---------- */
function poolForRange(lo, hi){
  const out = [];
  for(let i=0;i<N;i++) if(LVIDX[i]>=lo && LVIDX[i]<=hi) out.push(WORDS[i]);
  return out;
}
function poolFor(levelIdx){ return poolForRange(Math.max(0, levelIdx-1), levelIdx); }
function pickSecret(lo, hi){
  const pool = poolForRange(lo, hi);
  const recent = new Set(store.recent.slice(-160));
  const fresh = pool.filter(w => !recent.has(w));
  const use = fresh.length > 30 ? fresh : pool;
  return use[Math.floor(Math.random()*use.length)];
}

/* ---------- persistence of unfinished games (every unfinished game is kept) ---------- */
function newGid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function findGame(gid){ return store.games.find(g => g.gid === gid) || null; }
function latestGame(){ return store.games.length ? store.games[store.games.length-1] : null; }
function persistCurrent(){
  if(!cfg || state !== "ongoing") return;
  if(REMOTE && !gameToken) return;   // /api/new still in flight: nothing to save yet
  const rec = { gid: cfg.gid, lo: cfg.lo, hi: cfg.hi, lang: cfg.lang || LANG, state,
                board: board.map(e => ({ word:e.word, isHint:e.isHint, r:(e.r!=null?e.r:null), d:(e.d!=null?e.d:null), n:(e.n||null) })),
                at: Date.now() };
  if(REMOTE) rec.token = gameToken; else rec.secret = secret;
  const rest = store.games.filter(g => g.gid !== cfg.gid);
  rest.push(rec);                     // most recent activity goes last (home "continue" uses the last)
  store.games = rest;
  while(store.games.length > 300) store.games.shift();
  save();
}
function finishToHistory(){
  store.history.push({ lo:cfg.lo, hi:cfg.hi, secret, state, lang: cfg.lang || LANG, board:board.map(e=>({word:e.word,isHint:e.isHint,distance:e.distance})), at:Date.now(), mv:MODEL_VER });
  while(store.history.length > 300) store.history.shift();
  if(secret){ store.recent.push(secret); while(store.recent.length > 200) store.recent.shift(); }
  if(cfg) store.games = store.games.filter(g => g.gid !== cfg.gid);
  save();
}

/* ---------- metrics ---------- */
function recalcMetrics(){
  let gc = 0, hc = 0;
  for(const e of board){ if(e.isHint){ hc++; } else gc++; }
  hintCount = hc;
  return gc;
}

/* ---------- validation ---------- */
const STOP_EN = new Set(["the","a","an","and","or","but","is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","could","should","may","might","must","can","i","you","he","she","it","we","they"]);
const BLOCKED = ["rape","rapes","retard","retards","nigga","niggas","nigger","niggers","faggot","faggots","negro","coon","kike","spastic"];
function validateGuess(raw){
  const w = raw.trim().toLowerCase();
  if(!w.length) return {valid:false, reason:"too-short"};
  if(w.length > 45) return {valid:false, reason:"too-long"};
  if(!LANGS[LANG].chars.test(w)) return {valid:false, reason:"invalid-character"};
  if(LANG==="en" && BLOCKED.some(b => w.startsWith(b))) return {valid:false, reason:"disallowed"};
  if(board.some(e => e.word === w)) return {valid:false, reason:"duplicate", word:w};
  if(LANG==="en" && STOP_EN.has(w)) return {valid:false, reason:"too-common"};
  return {valid:true, word:foldWord(w)};
}
function foldWord(w){
  if(IDX.has(w)) return w;
  return LEMMA.get(w) || null;
}

/* ---------- hint target (nearest unused rank closer than best) ---------- */
function boardRanks(){ return board.map(e => e.r).filter(x => x != null); }
function pickHintRank(giveUp){
  const n = ranks.N;
  const rs = boardRanks();
  const used = new Set(rs);
  if(giveUp) return 1;
  const best = rs.length ? Math.min(...rs) : null;
  if(best === null) return Math.max(2, Math.round(1 + (1000-1)/ranks.K));
  if(best <= 20){
    for(let x=best-1; x>=2; x--) if(!used.has(x)) return x;
    for(let x=best+1; x<=20; x++) if(!used.has(x)) return x;
    for(let x=21; x<=n; x++) if(!used.has(x)) return x;
    return null;
  }
  let x = Math.ceil(0.8*best);
  if(x<=1) x=2; if(x>n) x=n;
  if(used.has(x)){
    for(let e=1; e<=50; e++){
      if(x-e>=2 && !used.has(x-e)) return x-e;
      if(x+e<=n && !used.has(x+e)) return x+e;
    }
  }
  return used.has(x) ? null : x;
}

/* ---------- sounds ---------- */
let AC = null;
function tone(freq, dur, type="sine", vol=0.05, when=0){
  if(!store.settings.sound) return;
  try{
    AC = AC || new (window.AudioContext||window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, AC.currentTime+when);
    g.gain.linearRampToValueAtTime(vol, AC.currentTime+when+0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime+when+dur);
    o.connect(g); g.connect(AC.destination);
    o.start(AC.currentTime+when); o.stop(AC.currentTime+when+dur+0.05);
  }catch(e){}
}
const sfx = {
  reveal(){ tone(660,.09); tone(880,.12,"sine",.05,.07); },
  error(){ tone(170,.15,"square",.03); },
  notfound(){ tone(140,.18,"square",.032); tone(110,.18,"square",.028,.08); },
  win(){ [523,659,784,1047].forEach((f,i)=>tone(f,.16,"sine",.06,i*.11)); },
  lose(){ tone(330,.24,"sine",.05); tone(220,.34,"sine",.05,.18); },
  click(){ tone(1250,.03,"sine",.022); }
};

/* ---------- icons ---------- */
const IC = {
  bulb:'<svg class="hintIc" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.6 10.8c.7.55 1.1 1.2 1.1 2.2h5c0-1 .4-1.65 1.1-2.2A6 6 0 0012 3z"/></svg>',
  flag:'<svg class="hintIc" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/></svg>',
  trophy:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4z"/><path d="M7 6H4a1 1 0 00-1 1c0 2.2 1.8 4 4 4M17 6h3a1 1 0 011 1c0 2.2-1.8 4-4 4"/></svg>',
  arrow:'<svg class="markerArrow" viewBox="0 0 24 24" fill="currentColor"><path d="M8 4l10 8-10 8z"/></svg>',
  sun:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>',
  sndOn:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7M18.4 5.6a9 9 0 010 12.8"/></svg>',
  sndOff:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
  bk:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4V3z"/></svg>',
  bkFill:'<svg class="ic" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4V3z"/></svg>',
  target:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></svg>',
  bulbSm:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.6 10.8c.7.55 1.1 1.2 1.1 2.2h5c0-1 .4-1.65 1.1-2.2A6 6 0 0012 3z"/></svg>',
  tag:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4L11 3.8a2 2 0 00-1.4-.6H4a1 1 0 00-1 1v5.6c0 .5.2 1 .6 1.4l9.6 9.6a2 2 0 002.8 0l4.6-4.6a2 2 0 000-2.8z"/><circle cx="7.5" cy="7.5" r="1" fill="currentColor" stroke="none"/></svg>',
  book:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5v14zM4 19.5A2.5 2.5 0 006.5 22H20v-5"/></svg>',
  search:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>',
  clock:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
  x:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chevR:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>'
};

/* ---------- rendering ---------- */
function barWidth(d){
  const n = d > 3000 ? 0.01 : 0.01 + 0.99*Math.pow(Math.min(Math.max((3000-d)/3000,0),1), 3.5);
  return 100*n;
}
const barColor = d => d<=300 ? "green" : d<=1500 ? "orange" : "red";
function rowHTML(e, withMarker){
  const win = e.distance===1 && !e.isHint;
  const icon = e.isHint ? (e.distance===1 ? IC.flag : IC.bulb) : "";
  const right = win ? IC.trophy : fmt(e.distance);
  const nbOn = store.notebook.includes(e.word);
  return `<div class="rowWrap">${withMarker?IC.arrow:""}
    <div class="row"><div class="fill ${barColor(e.distance)}" data-w="${barWidth(e.distance)}"></div>
    <div class="rowContent"><span class="rowWord" data-w="${e.word}">${icon}${cap(e.word)}</span><button type="button" class="nbT${nbOn?" on":""}" data-w="${e.word}" aria-label="生词本">${nbOn?IC.bkFill:IC.bk}</button><span class="rowNum">${right}</span></div></div></div>`;
}
function animateRows(container){
  const set = () => container.querySelectorAll(".fill").forEach(f => f.style.width = f.dataset.w + "%");
  requestAnimationFrame(()=>requestAnimationFrame(set));
  setTimeout(set, 120);
}
function renderResultArea(){
  const ra = $("resultArea");
  if(result){
    if(result.type==="loading") ra.innerHTML = '<div class="msgRow loading">思考中...</div>';
    else if(result.type==="preparing") ra.innerHTML = '<div class="msgRow loading">正在准备神秘词…</div>';
    else if(result.type==="error") ra.innerHTML = `<div class="msgRow">${result.msg}</div>`;
    else if(result.type==="success"){ ra.innerHTML = rowHTML(result.guess, true); animateRows(ra); }
    return;
  }
  ra.innerHTML = "";
}
function renderBoard(){
  const b = $("board");
  b.innerHTML = board.map(e => rowHTML(e, marker!=null && e.distance===marker)).join("");
  animateRows(b);
  $("sep").style.display = board.length ? "block" : "none";
  $("emptyState").style.display = board.length ? "none" : "block";
}
function renderInputRow(){
  const gc = recalcMetrics();
  $("guessCounter").textContent = "#"+(gc+1);
  $("guessCounter").style.display = state==="ongoing" ? "" : "none";
  const inp = $("guessInput");
  const wasDisabled = inp.disabled;
  inp.disabled = busy || state!=="ongoing";
  if(wasDisabled && !inp.disabled) refocusGameInput();
  if(state==="won") inp.placeholder = "猜对了!答案就是 " + cap(secret);
  else if(state==="lost") inp.placeholder = "没猜中。答案是 " + cap(secret);
  else inp.placeholder = phText();
  let anyHint = true;
  try{ anyHint = pickHintRank(false) != null; }catch(e){}
  $("hintItem").classList.toggle("dis", !anyHint);
  $("menuWrap").style.display = state==="ongoing" ? "" : "none";
  $("resultsBtn").classList.toggle("show", state!=="ongoing");
}
function renderAll(){
  renderInputRow(); renderBoard(); renderResultArea();
  if(marker!=null){
    const el = $("board").querySelector(".markerArrow");
    if(el) el.scrollIntoView({block:"nearest", behavior:"smooth"});
  }
}

/* ---------- game actions ---------- */
function applyEntry(entry){
  const dup = board.find(x => x.word===entry.word);
  if(dup && !entry.force){
    result = {type:"error", msg:`“${cap(entry.word)}”已经猜过了`};
    marker = dup.distance;
    renderAll(); return;
  }
  entry.n = board.reduce((m,x)=>Math.max(m, x.n||0), 0) + 1;   // 第几猜（结果页名次曲线的横轴）
  result = {type:"success", guess:entry};
  board = [...board, entry].sort((a,b)=>a.distance-b.distance);
  marker = entry.distance;
  const win = entry.distance===1;
  if(win){
    const gaveUp = entry.isHint;
    state = gaveUp ? "lost" : "won";
    persistCurrent(); finishToHistory();
    setTimeout(()=> gaveUp ? sfx.lose() : sfx.win(), 350);
    setTimeout(()=>{ if(state!=="ongoing" && !resultsOpen) showResults(); }, 1300);
  } else {
    persistCurrent();
    setTimeout(sfx.reveal, 120);
  }
  renderAll();
}
async function submitGuess(raw){
  if(busy || state!=="ongoing" || !cfg) return false;
  const v = validateGuess(raw);
  if(!v.valid){
    const M = { "too-short":"词语太短", "too-long":"词语太长", "invalid-character":"请输入有效的" + langCn() + "单词",
      "disallowed":"不行哦。", "too-common":"这个词太常见了,换一个试试" };
    if(v.reason==="duplicate"){
      const ex = board.find(e => e.word===v.word);
      result = {type:"error", msg:`“${cap(v.word)}”已经猜过了`};
      marker = ex ? ex.distance : null;
      renderAll();
    } else {
      result = {type:"error", msg:M[v.reason]};
      if(v.reason!=="too-short") sfx.error();
      renderResultArea();
    }
    return false;
  }
  const word = v.word;
  if(word==null || !IDX.has(word)){
    result = {type:"error", msg:"抱歉,词表里没有这个词"};
    sfx.notfound(); renderResultArea(); return false;
  }
  busy = true;
  result = {type:"loading"};
  renderInputRow(); renderResultArea();
  let r, d;
  if(REMOTE){
    if(!gameToken && !(await ensureToken())){
      busy = false;
      result = {type:"error", msg:"网络异常,请重试"};
      sfx.error(); renderResultArea(); return false;
    }
    let it = null;
    try{
      const j = await apiPost("/guess", { t: gameToken, words:[word] });
      it = j.items && j.items[0];
    }catch(e){
      busy = false;
      result = {type:"error", msg:"网络异常,请重试"};
      sfx.error(); renderResultArea(); return false;
    }
    if(!it){
      busy = false;
      result = {type:"error", msg:"抱歉,词表里没有这个词"};
      sfx.notfound(); renderResultArea(); return false;
    }
    r = it.r; d = it.d;
    if(r === 1) secret = word;   // guessed the secret — the only way to learn it before the end
  } else {
    await new Promise(res => setTimeout(res, 180 + Math.random()*140));
    r = ranks.rankOf.get(word);
    d = ranks.distOf[r-1];
  }
  busy = false;
  applyEntry({word, r, d, distance:d, isHint:false});
  return true;
}
async function requestHint(giveUp){
  if(busy || state!=="ongoing" || !cfg) return;
  busy = true;
  result = {type:"loading"};
  renderInputRow(); renderResultArea();
  if(REMOTE && !gameToken && !(await ensureToken())){
    busy = false;
    result = {type:"error", msg:"网络异常,请重试"};
    sfx.error(); renderResultArea(); return;
  }
  const tr = giveUp ? 1 : pickHintRank(false);
  if(tr == null){
    busy = false;
    result = {type:"error", msg:"获取提示失败,请重试"};
    sfx.error(); renderResultArea(); return;
  }
  let word, d, r;
  if(REMOTE){
    try{
      const j = await apiPost("/hint", { t: gameToken, r: tr });
      word = j.word; d = j.d; r = j.r || tr;
    }catch(e){
      busy = false;
      result = {type:"error", msg:"网络异常,请重试"};
      sfx.error(); renderResultArea(); return;
    }
    if(giveUp) secret = word;   // revealed by the rank-1 hint
  } else {
    await new Promise(res => setTimeout(res, 240));
    word = ranks.wordAt[tr-1]; d = ranks.distOf[tr-1]; r = tr;
  }
  busy = false;
  applyEntry({word, r, d, distance:d, isHint:true, force:giveUp});
}
function clearResult(){ result = null; marker = null; renderResultArea(); }

/* ---------- results & stats ---------- */
function showResults(){
  resultsOpen = true;
  $("gameView").style.display = "none";
  $("resultsView").style.display = "block";
  window.scrollTo(0,0);
  const won = state==="won";
  $("resTitle").textContent = won ? "猜对了!答案就是" : "没猜中。答案是";
  const rw = $("resWord");
  rw.textContent = cap(secret);
  rw.dataset.w = secret;
  rw.className = "resWord "+(won?"won":"lost");
  const gc = recalcMetrics();
  $("chipGuesses").innerHTML = IC.target + ` ${gc} 次猜测`;
  $("chipHints").innerHTML = IC.bulbSm + ` ${hintCount} 次提示`;
  $("chipMode").innerHTML = IC.book + ` ${escHtml(LANGS[LANG].badge)} ${escHtml(rangeLabel(cfg.lo, cfg.hi))}`;
  renderStats();
  renderHomeStats();
}
function hideResults(){
  resultsOpen = false;
  $("resultsView").style.display = "none";
  $("gameView").style.display = "block";
}
function historyStats(){
  let played=0, wins=0, sum=0;
  for(const g of store.history){
    if(g.state!=="won" && g.state!=="lost") continue;
    played++;
    if(g.state==="won"){ wins++; sum += (g.board||[]).filter(e=>!e.isHint).length; }
  }
  return {played, wins, avg: wins? (sum/wins):0};
}
// 本局每次猜测的名次曲线（横轴=第几猜，纵轴=该词在词库中的绝对名次，对数刻度，1 在顶部）
function rankCurveSVG(){
  const pts = board
    .map(e => ({ w:e.word, n:e.n||0, r:(e.r!=null ? e.r : null), hint:!!e.isHint }))
    .filter(p => p.r != null && p.r >= 1);
  if(!pts.length) return "";
  pts.sort((a,b) => (a.n||0) - (b.n||0));
  let last = 0;
  for(const p of pts){ if(!p.n) p.n = last + 1; last = p.n; }   // 老存档没有次序时按现有顺序补
  const NMAX = Math.max(2, N);
  const W = 520, H = 200, PL = 62, PR = 16, PT = 14, PB = 24;
  const xs = n => pts.length <= 1 ? (PL + W - PR) / 2 : PL + (n-1)/(pts[pts.length-1].n - 1) * (W - PL - PR);
  const ys = r => PT + (Math.log(Math.max(1, Math.min(NMAX, r))) / Math.log(NMAX)) * (H - PT - PB);
  const ticks = [1, 10, 100, 1000].filter(t => t < NMAX).concat([NMAX]);
  const grid = ticks.map(t =>
    `<line class="rcGrid" x1="${PL}" y1="${ys(t).toFixed(1)}" x2="${W-PR}" y2="${ys(t).toFixed(1)}"/>` +
    `<text class="rcTick" x="${PL-8}" y="${(ys(t) + (t===NMAX ? -5 : 3.5)).toFixed(1)}">${fmt(t)}</text>`).join("");
  const line = pts.length > 1
    ? `<polyline class="rcLine" points="${pts.map(p => xs(p.n).toFixed(1)+","+ys(p.r).toFixed(1)).join(" ")}"/>` : "";
  const hits = pts.map(p =>
    `<circle class="rcHit" cx="${xs(p.n).toFixed(1)}" cy="${ys(p.r).toFixed(1)}" r="15" data-w="${escHtml(p.w)}"/>`).join("");
  const dots = pts.map(p => {
    const x = xs(p.n).toFixed(1), y = ys(p.r).toFixed(1);
    const tip = `<title>第 ${p.n} 猜${p.hint?"(提示)":""}:${escHtml(cap(p.w))} · 第 ${fmt(p.r)} 名</title>`;
    if(p.r === 1) return `<circle class="rcWin" cx="${x}" cy="${y}" r="7.5" data-w="${escHtml(p.w)}">${tip}</circle>`;
    if(p.hint)    return `<rect class="rcHint" x="${(x-5.2).toFixed(1)}" y="${(y-5.2).toFixed(1)}" width="10.4" height="10.4" transform="rotate(45 ${x} ${y})" data-w="${escHtml(p.w)}">${tip}</rect>`;
    return `<circle class="rcDot" cx="${x}" cy="${y}" r="4.6" data-w="${escHtml(p.w)}">${tip}</circle>`;
  }).join("");
  const endN = pts[pts.length-1].n;
  const xlab = `<text class="rcTick rcX" x="${PL}" y="${H-4}">第1猜</text>`
    + (endN > 1 ? `<text class="rcTick rcX" x="${W-PR-10}" y="${H-4}">第${endN}猜</text>` : "");
  return `<svg class="rankSvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="本局每次猜测的名次曲线">${grid}${line}${hits}${dots}${xlab}</svg>`;
}
function renderStats(){
  const h = historyStats();
  $("statSub").textContent = h.played===0 ? "还没有记录,来玩一局吧!"
    : (h.wins ? `已完成 ${h.played} 局 · 胜率 ${Math.round(h.wins/h.played*100)}% · 平均 ${h.avg.toFixed(1)} 次猜中`
              : `已完成 ${h.played} 局 · 快来赢下第一局!`);
  const svg = rankCurveSVG();
  $("rankChart").innerHTML = svg || '<div class="rcEmpty">本局还没有可绘制的猜测记录。</div>';
  $("chartCap").textContent = svg ? "本局每次猜测的名次(纵轴:1 = 答案,越靠上越接近,对数刻度) · 橙色菱形为提示 · 点圆点查词典" : "";
}
function renderHomeStats(){
  const h = historyStats();
  const el = $("homeStats");
  if(h.played===0){ el.innerHTML = ""; return; }
  el.innerHTML = `<span class="chip">${h.played} 局游戏</span>` +
    (h.wins ? `<span class="chip">胜率 ${Math.round(h.wins/h.played*100)}%</span>` : "");
}

/* ---------- share ---------- */
function shareText(){
  const gc = recalcMetrics();
  if(state==="won") return `我在 GuessWord(${LANGS[LANG].badge} ${rangeLabel(cfg.lo, cfg.hi)})用 ${gc} 次猜测猜中了 “${cap(secret)}”!(${hintCount} 次提示)`;
  return `我在 GuessWord(${LANGS[LANG].badge} ${rangeLabel(cfg.lo, cfg.hi)})里放弃了,答案是 “${cap(secret)}”。`;
}
async function copyText(s){
  try{ await navigator.clipboard.writeText(s); return true; }
  catch(e){
    try{
      const ta = document.createElement("textarea");
      ta.value = s; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove(); return true;
    }catch(e2){ return false; }
  }
}
let toastTimer = null;
function toast(msg){
  const el = $("toast");
  el.textContent = msg; el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.remove("show"), 2300);
}

/* ---------- dialogs ---------- */
function openOv(id){ $(id).classList.add("open"); }
function closeOv(id){ $(id).classList.remove("open"); }
function refocusGameInput(){
  const coarse = window.matchMedia && window.matchMedia("(pointer:coarse)").matches;
  if(coarse) return;
  if($("game").classList.contains("on") && state==="ongoing" && !busy){
    setTimeout(()=>{ try{ $("guessInput").focus(); }catch(e){} }, 60);
  }
}
let confirmAction = null;
function askConfirm(title, body, action){
  $("confirmTitle").textContent = title;
  $("confirmBody").textContent = body;
  confirmAction = action;
  openOv("confirmOverlay");
}
$("confirmCancel").onclick = ()=> closeOv("confirmOverlay");
$("confirmYes").onclick = ()=>{ closeOv("confirmOverlay"); if(confirmAction){ const a = confirmAction; confirmAction = null; a(); } };

/* menu */
$("menuBtn").onclick = e =>{ e.stopPropagation(); sfx.click(); $("dropdown").classList.toggle("open"); };
document.addEventListener("click", e=>{ if(!e.target.closest(".menuWrap")) $("dropdown").classList.remove("open"); });
$("hintItem").onclick = ()=>{
  $("dropdown").classList.remove("open");
  requestHint(false);
};
$("giveupItem").onclick = ()=>{
  $("dropdown").classList.remove("open");
  askConfirm("放弃?", "确定要放弃吗?答案会被揭晓,游戏结束。", ()=> requestHint(true));
};

/* header */
$("helpBtn").onclick = ()=> openOv("htpOverlay");
$("htpOk").onclick = ()=> closeOv("htpOverlay");
$("homeBtn").onclick = ()=>{
  if(state==="ongoing" && board.length>0){
    askConfirm("回到首页?", "这一局的进度会保留,可以随时继续。", ()=> goHome());
  } else goHome();
};
function goHome(){
  hideResults();
  switchScreen("home");
  refreshHome();
}
document.querySelectorAll(".overlay").forEach(ov=>{
  ov.addEventListener("click", e=>{ if(e.target===ov){ ov.classList.remove("open"); refocusGameInput(); } });
});
document.addEventListener("keydown", e=>{
  if(e.key==="Escape"){
    document.querySelectorAll(".overlay.open").forEach(o=>o.classList.remove("open"));
    $("dropdown").classList.remove("open");
    hideAc();
    refocusGameInput();
  }
});

/* theme & sound quick toggles (all screens) */
function applyTheme(){
  document.documentElement.dataset.theme = store.settings.theme || "dark";
  document.querySelectorAll(".themeT").forEach(b=>{
    b.innerHTML = (store.settings.theme==="light") ? IC.moon : IC.sun;
  });
}
function syncSoundUI(){
  document.querySelectorAll(".sndT").forEach(b=>{
    b.innerHTML = store.settings.sound ? IC.sndOn : IC.sndOff;
  });
}
document.querySelectorAll(".themeT").forEach(b=>{
  b.onclick = ()=>{
    store.settings.theme = store.settings.theme==="light" ? "dark" : "light";
    save(); applyTheme(); sfx.click();
  };
});
document.querySelectorAll(".sndT").forEach(b=>{
  b.onclick = ()=>{
    store.settings.sound = !store.settings.sound;
    save(); syncSoundUI();
    if(store.settings.sound) sfx.click();
  };
});

/* ---------- notebook ---------- */
function openNotebook(){ renderNbList(); openOv("nbOverlay"); }
function renderNbList(){
  const list = $("nbList"), words = store.notebook;
  $("nbSub").textContent = words.length ? `共 ${words.length} 个词 · 点 × 移除,「复制全部」可导出复习` : "";
  if(!words.length){
    list.innerHTML = `<div class="nbEmpty">还没有收藏。猜词时点击行尾的书签图标,可以把答案、提示词或你的猜测收进来。</div>`;
    return;
  }
  list.innerHTML = [...words].reverse().map(w=>{
    const li = IDX.has(w) ? LVIDX[IDX.get(w)] : null;
    const tag = li!=null && li<=5 ? `<span class="nbL">${LEVELS[li]}</span>` : "";
    return `<div class="nbItem"><span class="nbW" data-w="${w}">${cap(w)}</span>${tag}<button class="nbDel" data-w="${w}" aria-label="移除">×</button></div>`;
  }).join("");
}
function toggleNotebook(w){
  const i = store.notebook.indexOf(w);
  const added = i<0;
  if(added) store.notebook.push(w); else store.notebook.splice(i,1);
  save(); sfx.click();
  document.querySelectorAll(`.nbT[data-w="${w}"]`).forEach(b=>{
    b.classList.toggle("on", added);
    b.innerHTML = added ? IC.bkFill : IC.bk;
  });
  if($("nbOverlay").classList.contains("open")) renderNbList();
  toast(added ? `已收藏 ${cap(w)}` : `已移除 ${cap(w)}`);
}
document.addEventListener("click", e=>{
  const t = e.target.closest(".nbT");
  if(t && t.dataset.w) toggleNotebook(t.dataset.w);
});
$("nbList").addEventListener("click", e=>{
  const d = e.target.closest(".nbDel");
  if(d){ toggleNotebook(d.dataset.w); return; }
  const wc = e.target.closest(".nbW");
  if(wc && wc.dataset.w) openDict(wc.dataset.w);
});
function nbAdd(){
  const inp = $("nbAddInp");
  const w = inp.value.trim().toLowerCase();
  if(!LANGS[LANG].chars.test(w)){ toast("请输入" + langCn() + "单词"); return; }
  if(!IDX.has(w)){ toast("词库里没有这个词"); return; }
  if(store.notebook.includes(w)){ toast("已在生词本中"); return; }
  store.notebook.push(w); save();
  inp.value = ""; renderNbList(); sfx.click(); toast(`已收藏 ${cap(w)}`);
}
$("nbAddBtn").onclick = nbAdd;
$("nbAddInp").addEventListener("keydown", e=>{ if(e.key==="Enter" && !e.isComposing){ e.preventDefault(); nbAdd(); } });
$("nbCopy").onclick = async ()=>{
  if(!store.notebook.length){ toast("生词本是空的"); return; }
  (await copyText(store.notebook.map(cap).join(", "))) ? toast(`已复制 ${store.notebook.length} 个词`) : toast("复制失败");
};
$("nbClose").onclick = ()=>{ closeOv("nbOverlay"); refocusGameInput(); };
$("nbHomeBtn").onclick = openNotebook;
$("nbItem").onclick = ()=>{ $("dropdown").classList.remove("open"); openNotebook(); };

/* ---------- dictionary ---------- */
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const POS_ZH = {noun:"名词",verb:"动词",adj:"形容词",adv:"副词",pron:"代词",prep:"介词",conj:"连词",det:"限定词",particle:"助词",intj:"感叹词",num:"数词",name:"专名",phrase:"短语",abbr:"缩写",symbol:"符号",suffix:"后缀",prefix:"前缀",aux:"助动词",article:"冠词"};
const DICT_CACHE = {};
const DICT_ONE = new Map();   // online mode: "lang|word" -> entry | null (miss) | 0 (error, not cached)
const DICT_ERR = 0;
async function dictLookupOne(lang, word){
  const key = lang + "|" + word;
  if(DICT_ONE.has(key)) return DICT_ONE.get(key);
  let v = null;
  try{
    const r = await fetch(apiURL("/def?lang=" + encodeURIComponent(lang) + "&word=" + encodeURIComponent(word)));
    if(!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    v = j.entry || null;
  }catch(e){ return DICT_ERR; }
  DICT_ONE.set(key, v);
  if(DICT_ONE.size > 4000) DICT_ONE.clear();
  return v;
}
let dlSeq = 0, dictLang = "en";
function loadDict(lang){
  lang = lang || LANG;
  if(DICT_CACHE[lang]) return Promise.resolve(DICT_CACHE[lang]);
  if(DICT_CACHE["!"+lang]) return Promise.resolve(null);
  const fn = DICT_SRC[lang];
  let b64 = null;
  try{ b64 = fn ? fn() : null; }catch(e){ b64 = null; }
  if(!b64) return Promise.resolve(null);
  return new Response(new Blob([Uint8Array.from(atob(b64), c=>c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
    .then(t=>{ DICT_CACHE[lang] = JSON.parse(t); return DICT_CACHE[lang]; })
    .catch(()=>{ DICT_CACHE["!"+lang] = true; return null; });
}
function openDict(w, lang){
  dictLang = (lang && LANGS[lang] && packAvailable(lang)) ? lang : LANG;
  openOv("dlOverlay");
  $("dlSearch").value = w ? (dictLang==="de" ? w : cap(w)) : "";
  renderDict(w ? w.toLowerCase() : "");
  setTimeout(()=>{ try{ $("dlSearch").focus(); }catch(e){} }, 60);
}
async function renderDict(q){
  const seq = ++dlSeq, box = $("dlEntry");
  const dl = dictLang;
  if(!q){ box.innerHTML = '<div class="dlEmpty">输入一个单词,或直接点击棋盘、生词本里的词。</div>'; return; }
  let key = null, e = null;
  const cands = [q, q.toLowerCase()];
  try{ const f = foldWord(q); if(f) cands.push(f); }catch(err){}
  if(REMOTE){
    box.innerHTML = '<div class="dlEmpty">词典加载中…</div>';
    for(const c of cands){
      if(!c) continue;
      const ent = await dictLookupOne(dl, c);
      if(ent === DICT_ERR){
        if(seq === dlSeq && $("dlOverlay").classList.contains("open")) box.innerHTML = '<div class="dlEmpty">词典加载失败,请重试。</div>';
        return;
      }
      if(ent){ key = c; e = ent; break; }
    }
    if(seq !== dlSeq || !$("dlOverlay").classList.contains("open")) return;
  } else {
    if(!DICT_CACHE[dl]){
      box.innerHTML = '<div class="dlEmpty">词典加载中…</div>';
      await loadDict(dl);
      if(seq !== dlSeq || !$("dlOverlay").classList.contains("open")) return;
      if(!DICT_CACHE[dl]){ box.innerHTML = '<div class="dlEmpty">词典数据加载失败。</div>'; return; }
    }
    const DD = DICT_CACHE[dl];
    for(const c of cands){ if(c && DD[c]){ key = c; e = DD[c]; break; } }
  }
  if(!key){ box.innerHTML = `<div class="dlEmpty">词典未收录 “${escHtml(q)}”。</div>`; return; }
  const P = getPack(dl);
  const li = (P && P.IDX.has(key)) ? P.LVIDX[P.IDX.get(key)] : null;
  const lv = li!=null && li<=5 ? `<span class="dlLv">${escHtml(levelsOf(dl)[li])}</span>` : "";
  let disp = key;
  if(dl === "en" || (dl === "de" && e.p && e.p.every(g=>g.p==="noun"))) disp = cap(key);
  const head = `<div class="dlHead"><span class="dlWord">${escHtml(disp)}</span>${lv}<button type="button" class="nbT dlNbT" data-w="${escHtml(key)}" aria-label="生词本">${store.notebook.includes(key)?IC.bkFill:IC.bk}</button></div>`;
  if(e.pos){   // english entries: {us,uk,pos:[{p,s:[{d,t,ex}]}],zh}
    const ipa = [];
    if(e.us) ipa.push(`<span class="dlIpa">美 /${escHtml(e.us)}/</span>`);
    if(e.uk) ipa.push(`<span class="dlIpa">英 /${escHtml(e.uk)}/</span>`);
    const posHtml = (e.pos||[]).map(pb=>{
      const senses = pb.s.map((s,i)=>{
        const tag = s.t ? `<i class="dlTag">${escHtml(s.t)}</i>` : "";
        const ex = (s.ex||[]).map(x=>`<div class="dlEx">“${escHtml(x)}”</div>`).join("");
        return `<div class="dlSense"><span class="dlN">${i+1}.</span><div class="dlSenseBody"><div class="dlDef">${tag}${escHtml(s.d)}</div>${ex}</div></div>`;
      }).join("");
      return `<div class="dlPosBlock"><div class="dlPos">${escHtml(pb.p)}</div>${senses}</div>`;
    }).join("");
    const zh = (e.zh && e.zh.length) ? `<div class="dlZh"><div class="dlZhH">中文释义 · ECDICT</div>${e.zh.map(z=>`<div class="dlZhLine">${escHtml(z)}</div>`).join("")}</div>` : "";
    const src = e.src === "e" ? "英文释义来源:ECDICT" : "英文释义来源:Wiktionary (CC BY-SA)";
    box.innerHTML = head
      + (ipa.length ? `<div class="dlIpaRow">${ipa.join("")}</div>` : "")
      + (posHtml || '<div class="dlEmpty">该词暂无释义数据。</div>') + zh
      + `<div class="dlSrc">${src} · 中文:ECDICT</div>`;
    return;
  }
  // non-english entries: {rd?, zhw?, p:[{p, s:[{d, z?, ex}]}]}
  const rd = e.rd ? `<div class="dlIpaRow"><span class="dlIpa">${escHtml(e.rd)}</span></div>` : "";
  const zhw = e.zhw ? `<div class="dlIpaRow"><span class="dlIpa">中文: ${escHtml(e.zhw)}</span></div>` : "";
  let hasZh = false;
  const posHtml = (e.p||[]).map(pb=>{
    const senses = pb.s.map((s,i)=>{
      const ex = (s.ex||[]).map(x=>`<div class="dlEx">“${escHtml(x)}”</div>`).join("");
      let def;
      if(s.z){ hasZh = true; def = `<div class="dlDef">${escHtml(s.z)}</div><div class="dlDefSub">${escHtml(s.d)}</div>`; }
      else def = `<div class="dlDef">${escHtml(s.d)}</div>`;
      return `<div class="dlSense"><span class="dlN">${i+1}.</span><div class="dlSenseBody">${def}${ex}</div></div>`;
    }).join("");
    return `<div class="dlPosBlock"><div class="dlPos">${escHtml(POS_ZH[pb.p] || pb.p || "")}</div>${senses}</div>`;
  }).join("");
  box.innerHTML = head + rd + zhw
    + (posHtml || '<div class="dlEmpty">该词暂无释义数据。</div>')
    + `<div class="dlSrc">释义来源:Wiktionary (CC BY-SA)${hasZh ? " · 中文译文为离线机器翻译" : ""}</div>`;
}
function dlQuery(){ renderDict($("dlSearch").value.trim().toLowerCase()); }
$("dlGo").onclick = dlQuery;
$("dlSearch").addEventListener("keydown", e=>{ if(e.key==="Enter" && !e.isComposing && e.keyCode!==229){ e.preventDefault(); dlQuery(); } });
$("dlClose").onclick = ()=>{ closeOv("dlOverlay"); refocusGameInput(); };
$("dlHomeBtn").onclick = ()=> openDict("");
$("dictItem").onclick = ()=>{ $("dropdown").classList.remove("open"); openDict(""); };
document.addEventListener("click", e=>{
  const t = e.target.closest(".rowWord");
  if(t && t.dataset.w) openDict(t.dataset.w);
});
document.addEventListener("click", e=>{
  const c = e.target.closest(".rankSvg .rcDot, .rankSvg .rcHint, .rankSvg .rcWin");
  if(c && c.dataset.w) openDict(c.dataset.w);
});

/* ---------- history ---------- */
function fmtWhen(at){
  if(!at) return "—";
  const d = new Date(at), now = new Date();
  const hm = String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
  const sameDay = a => a.getFullYear()===d.getFullYear() && a.getMonth()===d.getMonth() && a.getDate()===d.getDate();
  const yd = new Date(now); yd.setDate(now.getDate()-1);
  if(sameDay(now)) return "今天 "+hm;
  if(sameDay(yd)) return "昨天 "+hm;
  return (d.getMonth()+1)+"/"+d.getDate()+" "+hm;
}
function histGameRows(g){
  const gl = (g.lang && LANGS[g.lang]) ? g.lang : "en";
  let dOf = null, rOf = null;
  if(g.secret){
    try{ const rg = buildRanks(g.secret, gl); if(rg){ dOf = rg.distOf; rOf = rg.rankOf; } }catch(e){}
  }
  const distOf = e => {
    if(e.distance && g.mv===MODEL_VER) return e.distance;   // finished games store the distance
    if(e.d != null) return e.d;                             // unfinished games store it too
    if(rOf){ const r = rOf.get(e.word); if(r) return dOf[r-1]; }
    return 3001;
  };
  return [...(g.board||[])].sort((a,b)=>distOf(a)-distOf(b)).map(e=>{
    const dist = distOf(e);
    return `<div class="hRow"><div class="hFill" style="width:${barWidth(dist)}%;background:var(--${barColor(dist)})"></div><span class="hw">${e.isHint?IC.bulbSm:""}${escHtml(cap(e.word))}${e.isHint?'<i class="hHint">提示</i>':""}</span><span class="hn">${dist===1 ? (e.isHint?"揭晓":"答案") : fmt(dist)}</span></div>`;
  }).join("");
}
function histRowHTML(g, opts){
  const won = g.state==="won";
  const gl = (g.lang && LANGS[g.lang]) ? g.lang : "en";
  const gc = (g.board||[]).filter(e=>!e.isHint).length;
  if(opts && opts.unfinished){
    return `<div class="histItem histOng" data-gid="${escHtml(g.gid)}">
      <div class="histRow ongRow"><span class="histSt o">${IC.clock}</span>
      <div class="ongMain">
        <div class="ongTop"><span class="histW">${escHtml(LANGS[gl].name)}</span><span class="histR">${escHtml(rangeLabelFor(g.lo,g.hi,gl))}</span></div>
        <div class="ongSub">已猜 ${gc} 次 · ${fmtWhen(g.at)}</div>
      </div>
      <button type="button" class="histCont" data-gid="${escHtml(g.gid)}">继续</button>
      <span class="histChev">${IC.chevR}</span></div>
      <div class="histDet"><div class="hRows">${histGameRows(g)}</div></div>
    </div>`;
  }
  return `<div class="histItem" data-i="${opts.i}">
      <div class="histRow"><span class="histSt ${won?"w":"l"}">${won?IC.trophy:IC.x}</span>
      <span class="histW" data-w="${escHtml(g.secret)}" data-lang="${escHtml(gl)}">${escHtml(gl==="de" ? g.secret : cap(g.secret))}${gl!=="en"?`<i class="histLang">${escHtml(LANGS[gl].name)}</i>`:""}</span>
      <span class="histR">${escHtml(rangeLabelFor(g.lo,g.hi,gl))}</span>
      <span class="histMeta">${gc} 猜 · ${fmtWhen(g.at)}</span>
      <span class="histChev">${IC.chevR}</span></div>
      <div class="histDet"><div class="hRows">${histGameRows(g)}</div></div>
    </div>`;
}
function histSecHTML(label){
  return `<div class="histSec">${label}</div>`;
}
function renderHist(){
  const games = store.history, list = $("histList");
  const wins = games.filter(g=>g.state==="won").length;
  const ong = store.games.slice().reverse();
  const parts = [];
  if(ong.length) parts.push(`${ong.length} 局未完成`);
  if(games.length) parts.push(`已完成 ${games.length} 局 · 胜 ${wins} · 胜率 ${Math.round(wins/games.length*100)}%`);
  $("histSub").textContent = parts.length ? parts.join(" · ") : "完成一局后会自动保存在这里。";
  if(!games.length && !ong.length){ list.innerHTML = `<div class="nbEmpty">还没有记录。来玩一局,结束的棋局都会存档在此。</div>`; return; }
  list.innerHTML =
      (ong.length ? histSecHTML(`未完成的对局 · ${ong.length} · 点“继续”接着玩`) + ong.map(g => histRowHTML(g, {unfinished:true})).join("") : "")
    + (games.length ? histSecHTML(`已完成 · ${games.length}`) + games.map((g,i) => histRowHTML(g, {i})).join("") : "");
}
function openHist(){ renderHist(); openOv("histOverlay"); }
$("histList").addEventListener("click", e=>{
  const cont = e.target.closest(".histCont");
  if(cont && cont.dataset.gid){
    closeOv("histOverlay"); refocusGameInput();
    sfx.click(); resumeGame(cont.dataset.gid);
    return;
  }
  const it = e.target.closest(".histItem");
  const w = e.target.closest(".histW");
  if(w && (w.dataset.w || w.dataset.rw)){
    const word = w.dataset.w || w.dataset.rw;
    const gl = w.dataset.lang || (it && it.dataset.gid && (findGame(it.dataset.gid)||{}).lang) || "en";
    if(word) openDict(word, gl);
    return;
  }
  if(it && e.target.closest(".histRow")) it.classList.toggle("open");
});
$("histClear").onclick = ()=>{
  if(!store.history.length && !store.games.length){ toast("还没有记录"); return; }
  const n = store.history.length + store.games.length;
  askConfirm("清空历史记录?", `将删除全部 ${n} 局存档(含未完成),不可恢复。`, ()=>{
    store.history = []; store.games = []; save(); renderHist(); renderHomeStats(); toast("已清空历史记录");
  });
};
$("histClose").onclick = ()=>{ closeOv("histOverlay"); refocusGameInput(); };
$("histHomeBtn").onclick = openHist;
$("histItem").onclick = ()=>{ $("dropdown").classList.remove("open"); openHist(); };

/* ---------- autocomplete ---------- */
let AC_ORDER = null, AC_ORDER_LANG = null, acList = [], acHl = -1;
function acOrder(){
  if(!AC_ORDER || AC_ORDER_LANG !== LANG){
    AC_ORDER = WORDS.map((w,i)=>i).sort((a,b)=> LVIDX[a]-LVIDX[b] || (WORDS[a]<WORDS[b]?-1:1));
    AC_ORDER_LANG = LANG;
  }
  return AC_ORDER;
}
function acSuggest(q){
  const guessed = new Set(board.map(e=>e.word));
  const out = [];
  for(const i of acOrder()){
    const w = WORDS[i];
    if(w && w.length>q.length && w.startsWith(q) && !guessed.has(w) && !STOP_EN.has(w) && !BLOCKED.some(b=>w.startsWith(b))){
      out.push(i);
      if(out.length>=8) break;
    }
  }
  return out;
}
function hideAc(){ $("acBox").style.display="none"; acList=[]; acHl=-1; }
function renderAc(){
  const q = $("guessInput").value.trim().toLowerCase();
  $("acBox").innerHTML = acList.map((i,ix)=>{
    const w = WORDS[i], li = LVIDX[i];
    return `<button type="button" class="acItem${ix===acHl?" hl":""}" data-i="${i}"><span><b>${w.slice(0,q.length)}</b>${w.slice(q.length)}</span><span class="lv">${li<=5?LEVELS[li]:""}</span></button>`;
  }).join("");
  $("acBox").style.display="block";
}
function updateAc(){
  const inp = $("guessInput");
  if(!store.settings.ac || state!=="ongoing" || inp.disabled){ hideAc(); return; }
  const q = inp.value.trim().toLowerCase();
  const minLen = LANG==="en" ? 3 : 1;
  if(q.length < minLen || !LANGS[LANG].chars.test(q)){ hideAc(); return; }
  acList = acSuggest(q); acHl = -1;
  if(acList.length) renderAc(); else hideAc();
}
function pickAc(ix, andSubmit){
  const inp = $("guessInput");
  inp.value = WORDS[acList[ix]];
  hideAc();
  inp.focus();
  if(andSubmit) doSubmit();
}
function pickAcWord(wi){   // data-i holds the index into WORDS (not the position in acList)
  const inp = $("guessInput");
  const w = WORDS[wi];
  if(typeof w === "string") inp.value = w;
  hideAc();
  inp.focus();
}
$("guessInput").addEventListener("input", updateAc);
$("guessInput").addEventListener("blur", ()=> setTimeout(hideAc, 120));
$("acBox").addEventListener("mousedown", e=> e.preventDefault());
$("acBox").addEventListener("click", e=>{
  const it = e.target.closest(".acItem");
  if(it) pickAcWord(+it.dataset.i);
});
function syncAcUI(){ $("acLabel").textContent = "自动补全 · " + (store.settings.ac ? "开" : "关"); }
$("acItem").onclick = ()=>{
  store.settings.ac = store.settings.ac === false;
  save(); syncAcUI(); sfx.click();
  $("dropdown").classList.remove("open");
  if(!store.settings.ac) hideAc();
};
document.addEventListener("click", e=>{ if(!e.target.closest("#guessForm")) hideAc(); });

/* ---------- home & setup ---------- */
function switchScreen(id){
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("on", s.id===id));
  window.scrollTo(0,0);
}
function refreshHome(){
  renderHomeStats();
  const c = latestGame();
  const canResume = !!(c && c.board && c.board.length > 0);
  const b = $("resumeBtn");
  b.classList.toggle("show", canResume);
  if(canResume){
    const cl = (c.lang && LANGS[c.lang]) ? c.lang : "en";
    const gc = (c.board||[]).filter(e => !e.isHint).length;
    b.innerHTML = `继续上局 · ${escHtml(LANGS[cl].badge)} ${escHtml(rangeLabelFor(c.lo, c.hi, cl))}${cl!=="en"?` · ${escHtml(LANGS[cl].name)}`:""} · 已猜 ${gc} 次`;
    b.onclick = ()=>{ sfx.click(); resumeGame(c.gid); };
  }
}
async function resumeGame(gid){
  const g = findGame(gid);
  if(!g) return;
  busy = true;
  try{
    if(g.lang && g.lang !== LANG){
      await ensurePack(g.lang);
      activateLang(g.lang);
      store.settings.lang = g.lang; save();
      renderLangRow(); try{ refreshLvCards(); }catch(e){}
    }
  }catch(e){
    busy = false;
    toast("该语言数据加载失败,请重试");
    return;
  }
  busy = false;
  startGame(g.lo, g.hi, g.gid);
}
$("startBtn").onclick = ()=>{
  sfx.click();
  selLo = null; selHi = null;
  refreshLvCards();
  renderLvSel();
  switchScreen("setup");
  warmLang();   // preload the language while the player picks a level range
};
$("backHome").onclick = ()=>{ switchScreen("home"); refreshHome(); };
const LV_META = {
  en: [{en:"A1", zh:"入门"},{en:"A2", zh:"基础"},{en:"B1", zh:"中级"},{en:"B2", zh:"中高级"},{en:"C1", zh:"高级"},{en:"C2", zh:"精通"}],
  ja: [{en:"N5", zh:"入门"},{en:"N4", zh:"初级"},{en:"N3", zh:"中级"},{en:"N2", zh:"中高级"},{en:"N1", zh:"高级"}],
  ko: [{en:"延世1", zh:"入门"},{en:"延世2", zh:"初级"},{en:"延世3", zh:"中级上"},{en:"延世4", zh:"中级下"},{en:"延世5", zh:"高级上"},{en:"延世6", zh:"高级下"}],
  common6: [{en:"频段1", zh:"最常用"},{en:"频段2", zh:"常用"},{en:"频段3", zh:"较常用"},{en:"频段4", zh:"进阶"},{en:"频段5", zh:"拓展"},{en:"频段6", zh:"低频"}],
};
const SRC_NOTE = {
  en: "神秘词取自区间内的牛津/CEFR-J 官方分级词表",
  ja: "神秘词取自 JLPT N5–N1 词表",
  ko: "神秘词取自延世韩国语教材 1–6 册词表",
  common: "神秘词取自语料词频分级表",
};
const lvMetaOf = lang => LV_META[lang] || LV_META.common6;
const srcNoteOf = lang => SRC_NOTE[lang] || SRC_NOTE.common;
let LV_COUNTS = [];
function refreshLvCards(){
  LV_COUNTS = LEVELS.map((_, i)=>LVIDX.reduce((a,l)=>a+(l===i?1:0), 0));
  $("lvGrid").innerHTML = lvMetaOf(LANG).map((m,i)=>
    `<button class="lvCard" data-i="${i}"><span class="nm">${m.en}</span><span class="ds">${m.zh}</span><span class="ct">${LV_COUNTS[i].toLocaleString("en-US")} 词</span></button>`).join("");
  const sn = $("srcNote"); if(sn) sn.textContent = srcNoteOf(LANG);
  $("dictCount").textContent = N.toLocaleString("en-US");
  $("secretCount").textContent = LVIDX.filter(l=>l<=5).length.toLocaleString("en-US");
  bindLvCards();
}
/* ---------- 难度选择:点击两点框区间 / 按住拖动框选(鼠标+触屏) / 悬停实时预览 ---------- */
const coarsePtr = window.matchMedia && window.matchMedia("(pointer:coarse)").matches;
let hoverIdx = null, dragging = false, dragStart = null, suppressClick = false;
function renderLvSel(){
  const cards = document.querySelectorAll(".lvCard");
  let lo = selLo, hi = selHi, pending = false;
  if(dragging){
    if(hoverIdx==null || hoverIdx===dragStart){ lo = dragStart; hi = null; pending = true; }
    else { lo = Math.min(dragStart, hoverIdx); hi = Math.max(dragStart, hoverIdx); }
  } else if(selLo!=null && selHi==null){
    pending = true;
    if(hoverIdx!=null && hoverIdx!==selLo){ lo = Math.min(selLo, hoverIdx); hi = Math.max(selLo, hoverIdx); }
  }
  cards.forEach((x,i)=>{
    const inR = lo!=null && hi!=null && i>=lo && i<=hi;
    x.classList.toggle("sel", inR);
    x.classList.toggle("pend", pending && !inR && lo!=null && i===lo);
  });
  const info = $("lvInfo"), begin = $("beginBtn");
  const resetBtn = selLo!=null ? `<button class="lvReset" type="button">重置</button>` : "";
  if(selLo==null && !dragging){
    info.innerHTML = `${IC.tag} ${coarsePtr ? "点一个等级作为起点,再点另一个等级框出区间" : "点击一个等级作为起点,或按住拖动直接框选区间"}`;
    begin.textContent = "请先选择区间";
    begin.classList.remove("ready");
  } else if(hi!=null){
    const real = selHi!=null && !dragging;
    info.innerHTML = `${IC.tag} ${real?"难度区间":"预览区间"} <b>${rangeLabel(lo, hi)}</b> · 区间内共 <b>${poolForRange(lo, hi).length.toLocaleString("en-US")}</b> 个候选词 ${real?resetBtn:""}`;
    begin.textContent = real ? "开始游戏" : "请先选择区间";
    begin.classList.toggle("ready", real);
  } else {
    info.innerHTML = `${IC.tag} 起点 <b>${LEVELS[lo]}</b> · ${coarsePtr ? "再点一个等级完成区间,点起点本身 = 单一级别" : "点击或拖到另一等级框出区间,再点起点本身 = 单一级别"} ${resetBtn}`;
    begin.textContent = "请先选择区间";
    begin.classList.remove("ready");
  }
  info.classList.add("show");
}
function lvIdxFromPoint(x, y){
  const el = document.elementFromPoint(x, y);
  const card = el && el.closest ? el.closest(".lvCard") : null;
  return card ? +card.dataset.i : null;
}
function bindLvCards(){
  document.querySelectorAll(".lvCard").forEach(c=>{
    c.addEventListener("pointerdown", e=>{
      if(e.pointerType==="mouse" && e.button!==0) return;
      dragging = true; dragStart = +c.dataset.i; hoverIdx = dragStart; suppressClick = false;
      renderLvSel();
    });
    c.addEventListener("mouseenter", ()=>{ if(dragging) return; hoverIdx = +c.dataset.i; renderLvSel(); });
    c.onclick = ()=>{
      if(suppressClick){ suppressClick = false; return; }
      sfx.click();
      const i = +c.dataset.i;
      if(selLo==null || selHi!=null){ selLo = i; selHi = null; }
      else { const lo0 = selLo; selLo = Math.min(lo0, i); selHi = Math.max(lo0, i); }
      hoverIdx = null;
      renderLvSel();
    };
  });
}
$("lvGrid").addEventListener("mouseleave", ()=>{ hoverIdx = null; if(!dragging) renderLvSel(); });
document.addEventListener("pointermove", e=>{
  if(!dragging) return;
  const i = lvIdxFromPoint(e.clientX, e.clientY);
  if(i!=null && i!==hoverIdx){ hoverIdx = i; renderLvSel(); }
});
document.addEventListener("pointerup", e=>{
  if(!dragging) return;
  dragging = false;
  const i = lvIdxFromPoint(e.clientX, e.clientY);
  if(i!=null) hoverIdx = i;
  if(hoverIdx!=null && hoverIdx!==dragStart){
    selLo = Math.min(dragStart, hoverIdx); selHi = Math.max(dragStart, hoverIdx);
    hoverIdx = null; sfx.click(); suppressClick = true;
    setTimeout(()=>{ suppressClick = false; }, 400);
  }
  renderLvSel();
});
document.addEventListener("pointercancel", ()=>{ if(dragging){ dragging = false; renderLvSel(); } });
$("lvInfo").addEventListener("click", e=>{
  if(e.target.closest(".lvReset")){ sfx.click(); selLo = null; selHi = null; hoverIdx = null; renderLvSel(); }
});
renderLvSel();
$("beginBtn").onclick = ()=>{
  if(selLo==null || selHi==null) return;
  sfx.click();
  startGame(selLo, selHi);
};

/* ---------- game lifecycle ---------- */
async function startGame(lo, hi, resumeGid){
  const g = (resumeGid != null) ? findGame(resumeGid) : null;
  cfg = { lo: g ? g.lo : lo, hi: g ? g.hi : hi, lang: LANG, gid: g ? g.gid : newGid() };
  secret = undefined; gameToken = null; ranks = null;
  board = []; state = "ongoing"; result = null; marker = null;
  resultsOpen = false;
  hideResults();
  $("modeBadge").textContent = LANGS[LANG].badge + " " + rangeLabel(cfg.lo, cfg.hi);
  switchScreen("game");
  // entering the game may need a server round trip (new secret / missing ranks):
  // show the board right away with a "preparing" note instead of freezing on the old screen
  const needsServer = REMOTE && (!g || !!g.token);
  if(needsServer){ result = {type:"preparing"}; renderAll(); }
  let ready = true;
  try{
    if(g){
      // resume a saved game (any language): board comes back as saved
      if(g.token && REMOTE){
        busy = true;
        ranks = { N, K:3000/N, remote:true };
        gameToken = g.token;
        board = (g.board||[]).map(e => ({ word:e.word, isHint:!!e.isHint, r:e.r, d:e.d, n:e.n, distance:e.d }));
        if(board.some(e => e.r == null || e.d == null)){
          try{
            const j = await apiPost("/guess", { t: gameToken, words: board.map(e => e.word) });
            board = (j.items || []).map((it, i) => {   // the API answers in request order
              const e = board[i];
              return it ? { ...e, r:it.r, d:it.d, distance:it.d } : e;
            }).filter(e => e.d != null);
          }catch(err){ toast("存档恢复失败,请重试"); ready = false; }
        }
      } else if(g.secret){
        if(REMOTE) await fallbackToLocal();     // a local-mode save needs the vector pack
        secret = g.secret;
        ranks = buildRanks(secret);
        board = (g.board||[]).filter(e => IDX.has(e.word)).map(e => {
          const r = ranks.rankOf.get(e.word);
          return { word:e.word, isHint:!!e.isHint, r, d: ranks.distOf[r-1], n: e.n, distance: ranks.distOf[r-1] };
        });
      } else {
        toast("该存档无法继续,已移除");
        store.games = store.games.filter(x => x.gid !== g.gid); save();
        ready = false;
      }
      board.sort((a,b)=>a.distance-b.distance);
    } else {
      if(REMOTE){
        // keep the UI responsive: the player can type while the secret is being created,
        // the first guess/hint awaits pendingNew (see ensureToken)
        pendingNew = apiPost("/new", { lang: LANG, lo, hi, recent: store.recent.slice(-160) })
          .then(j => {
            gameToken = j.t; ranks = { N, K:3000/N, remote:true };
            if(result && result.type === "preparing"){ result = null; renderAll(); }
            persistCurrent();
            return j.t;
          })
          .catch(async () => {
            pendingNew = null;
            await fallbackToLocal();
            secret = pickSecret(lo, hi); ranks = buildRanks(secret);
            if(result && result.type === "preparing"){ result = null; renderAll(); }
            persistCurrent();
            return null;
          });
      } else {
        secret = pickSecret(lo, hi);
        ranks = buildRanks(secret);
        persistCurrent();
      }
    }
  } finally {
    busy = false;
  }
  if(ready){ renderAll(); $("guessInput").focus(); }
  else switchScreen("home"), refreshHome();
  warmLang();   // keep the isolate warm for the first guess
}
// wait for the in-flight /api/new of the current game (player may have typed early)
async function ensureToken(){
  if(gameToken || !pendingNew) return !!gameToken;
  try{ await pendingNew; }catch(e){}
  return !!gameToken;
}
// online engine unreachable (offline / server error): degrade to the local vector engine
async function fallbackToLocal(){
  if(!window.__loadLang){ toast("在线引擎不可用,请检查网络后重试"); return; }
  REMOTE = false;
  toast("在线引擎暂不可用,已切换为本地词库模式");
  try{
    await window.__loadLang(LANG, f => toast("正在下载本地词库 " + Math.round(f*100) + "%"));
    delete packCache[LANG];
    getPack(LANG);
    activateLang(LANG);
  }catch(e){ toast("本地词库下载失败,请检查网络"); }
}

/* ---------- results buttons ---------- */
$("resultsBtn").onclick = ()=>{ sfx.click(); showResults(); };
$("resWord").onclick = ()=>{ if(secret) openDict(secret); };
$("boardBtn").onclick = ()=>{ if(!cfg) return; hideResults(); };
$("newWordBtn").onclick = async ()=>{
  if(!cfg) return;
  sfx.click();
  hideResults();
  cfg.gid = newGid();
  secret = undefined; gameToken = null; pendingNew = null;
  board = []; state = "ongoing"; result = null; marker = null;
  if(REMOTE){
    result = {type:"preparing"};
    pendingNew = apiPost("/new", { lang: LANG, lo: cfg.lo, hi: cfg.hi, recent: store.recent.slice(-160) })
      .then(j => {
        gameToken = j.t; ranks = { N, K:3000/N, remote:true };
        if(result && result.type === "preparing"){ result = null; renderAll(); }
        persistCurrent();
        return j.t;
      })
      .catch(async () => {
        pendingNew = null;
        secret = pickSecret(cfg.lo, cfg.hi); ranks = buildRanks(secret);
        if(result && result.type === "preparing"){ result = null; renderAll(); }
        persistCurrent();
        return null;
      });
  } else {
    secret = pickSecret(cfg.lo, cfg.hi);
    ranks = buildRanks(secret);
    persistCurrent();
  }
  renderAll();
  $("guessInput").focus();
};
$("shareBtn").onclick = async ()=>{
  if(!cfg) return;
  (await copyText(shareText())) ? toast("已复制到剪贴板") : toast("复制失败");
};

/* ---------- form ---------- */
function doSubmit(){
  hideAc();
  const inp = $("guessInput");
  submitGuess(inp.value).then(ok => { if(ok) inp.value = ""; });
}
$("guessForm").addEventListener("submit", e=>{ e.preventDefault(); doSubmit(); });
$("guessInput").addEventListener("keydown", e=>{
  const acOpen = $("acBox").style.display==="block" && acList.length>0;
  if(acOpen && (e.key==="ArrowDown" || e.key==="ArrowUp")){
    e.preventDefault();
    acHl = e.key==="ArrowDown" ? (acHl+1)%acList.length : (acHl-1+acList.length)%acList.length;
    renderAc();
    const el = $("acBox").children[acHl];
    if(el) el.scrollIntoView({block:"nearest"});
    return;
  }
  if(acOpen && e.key==="Tab"){
    e.preventDefault(); pickAc(acHl>=0 ? acHl : 0, false); return;
  }
  if(acOpen && e.key==="Escape"){ hideAc(); return; }
  if(e.key==="Enter" && !e.isComposing && e.keyCode!==229){
    e.preventDefault();
    if(acOpen && acHl>=0) pickAc(acHl, true);
    else doSubmit();
  }
});
/* placeholder dots */
let dotIdx = 0;
setInterval(()=>{
  const inp = $("guessInput");
  if(!cfg || state!=="ongoing" || inp.disabled || inp.value.length>0) return;
  const dots = ["", ".", "..", "..."];
  inp.placeholder = phText() + dots[dotIdx++ % 4];
}, 500);
$("guessInput").addEventListener("input", ()=>{
  const inp = $("guessInput");
  if(inp.value.length>0 && !inp.placeholder.startsWith(phText())) inp.placeholder = phText();
  if(inp.value.length===0) inp.placeholder = phText();
});

/* ---------- language switch ---------- */
function renderLangRow(){
  const row = $("langRow");
  if(!row) return;
  const canLoad = k => packAvailable(k) || !!window.__loadLang;
  row.innerHTML = Object.keys(LANGS).filter(canLoad).map(k =>
    `<button type="button" class="langBtn${k===LANG?" on":""}" data-lang="${k}">${LANGS[k].name}</button>`).join("");
  row.querySelectorAll(".langBtn").forEach(b => { b.onclick = ()=> selectLang(b.dataset.lang); });
}
async function selectLang(lang){
  if(lang===LANG || !LANGS[lang]) return;
  if(!packAvailable(lang)){
    const btn = document.querySelector(`.langBtn[data-lang="${lang}"]`);
    if(btn) btn.classList.add("busy");
    try{ await ensurePack(lang); }catch(e){}
    if(btn) btn.classList.remove("busy");
    if(!packAvailable(lang)){ toast("该语言数据加载失败,请重试"); return; }
  }
  sfx.click();
  activateLang(lang);
  store.settings.lang = lang; save();
  try{ refreshLvCards(); }catch(e){}
  renderLangRow();
  refreshHome();
  warmLang(lang);   // preload the newly selected language on the server
}

/* ---------- boot ---------- */
REMOTE = !!(window.__gwRemote && typeof fetch === "function");
applyTheme();
syncSoundUI();
syncAcUI();
$("histHomeBtn").innerHTML = IC.clock;
$("nbHomeBtn").innerHTML = IC.book;
$("dlHomeBtn").innerHTML = IC.search;
if(!REMOTE) loadDict();
switchScreen("home");
refreshHome();
renderLangRow();
$("demoTrophy").innerHTML = IC.trophy;
$("dictCount").textContent = N.toLocaleString("en-US");
$("secretCount").textContent = LVIDX.filter(l=>l<=5).length.toLocaleString("en-US");
window.__gw = {
  get answer(){ return secret || null; },
  get token(){ return gameToken; },
  remote: () => REMOTE,
  rankOf: w => ranks && ranks.rankOf ? ranks.rankOf.get(w) : undefined,
  distOf: r => ranks && ranks.distOf ? ranks.distOf[r-1] : undefined,
  info: () => ({N, levels: LEVELS.map((L,i)=>L+":"+poolFor(i).length)})
};
warmLang();   // first game click should not wait for a cold isolate
