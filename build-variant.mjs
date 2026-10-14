// Build the split/parallel-load MULTILINGUAL deploy variant of GuessWord from the split sources
// (index.html + css/app.css + js/data-*.js + js/app.js, composed by build/compose.mjs).
// Sources stay untouched; output goes to site/ (index.html + data/* + _headers).
// Usage: node build-variant.mjs [secondary-data-origin]
//   Secondary origin (e.g. https://<hash>.guessword-173.pages.dev) gives the browser a second
//   TCP flow for chunk downloads (~2x cold-boot throughput on lossy links).
// Per language L: data/gw-<L>-meta.json + data/gw-<L>-vec-<i>.bin + data/gwdict-<L>-<i>.bin
// en/ja/ko packs live in js/data-*.js; fr/de/es come from D:/gw-dl/lang/pack-<L>.json + dict-<L>.json.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { compose } from './build/compose.mjs';

const ROOT = 'D:/workspace/guessword';
const OUT = 'D:/workspace/guessword/site';
const WRANGLER_TOML = 'D:/workspace/guessword/wrangler.toml';
const LANGDIR = 'D:/gw-dl/lang';
const VER = 'v20261014b';   // bump on data change to bust immutable caches
const SECHOST = (process.argv[2] || '').replace(/\/$/, '');
const CHUNK_BYTES = 900000; // ~0.9MB per chunk
const CHUNK_LANGS = ['en', 'ja', 'ko', 'fr', 'de', 'es'];

try {
  fs.rmSync(OUT, { recursive: true, force: true });
} catch (e) {
  // site/ can still be some other process's working directory (e.g. an interrupted deploy):
  // Windows refuses to delete the directory itself, but its contents can go.
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT, { withFileTypes: true })) {
    try { fs.rmSync(path.join(OUT, f.name), { recursive: true, force: true }); } catch (e2) { /* keep going */ }
  }
}
fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });

const src = compose(ROOT);
const lines = src.split('\n');
const find = (pred, from = 0) => {
  for (let i = from; i < lines.length; i++) if (pred(lines[i])) return i;
  throw new Error('marker not found: ' + pred);
};

// ---- collect packs and dicts ----
const PACKS = {}, DICTS = {};
const readConstJson = (name, lenTrim = 1) => {
  const i = find(l => l.startsWith('const ' + name + '='));
  return { i, val: JSON.parse(lines[i].slice(('const ' + name + '=').length, lines[i].length - lenTrim)) };
};
PACKS.en = readConstJson('GWD');
PACKS.ja = readConstJson('GW_JA');
PACKS.ko = readConstJson('GW_KO');
for (const [name, L] of [['GWDICT_B64', 'en'], ['GWDICT_JA_B64', 'ja'], ['GWDICT_KO_B64', 'ko']]) {
  const i = find(l => l.startsWith('const ' + name + '='));
  const m = new RegExp('^const ' + name + '="([A-Za-z0-9+/=]+)";?\\s*$').exec(lines[i]);
  if (!m) throw new Error(name + ' line format unexpected');
  DICTS[L] = Buffer.from(m[1], 'base64');
  if (DICTS[L][0] !== 0x1f || DICTS[L][1] !== 0x8b) throw new Error(L + ' dict payload is not gzip');
}
for (const L of ['fr', 'de', 'es']) {
  PACKS[L] = { i: -1, val: JSON.parse(fs.readFileSync(`${LANGDIR}/pack-${L}.json`, 'utf8')) };
  DICTS[L] = zlib.gzipSync(fs.readFileSync(`${LANGDIR}/dict-${L}.json`), { level: 9 });
}

// ---- surgery 1: en GWD keeps metadata only; ja/ko packs become null stubs (chunk-loaded) ----
const gi = PACKS.en.i, GWD = PACKS.en.val;
const vecEn = Buffer.from(GWD.vec, 'base64');
if (vecEn.length !== GWD.N * GWD.D) throw new Error(`vec size ${vecEn.length} != ${GWD.N * GWD.D}`);
lines[gi] = 'const GWD=' + JSON.stringify({ N: GWD.N, D: GWD.D, words: GWD.words, level: GWD.level, min: GWD.min, max: GWD.max }) + ';';
lines[PACKS.ja.i] = 'let GW_JA=null;';
lines[PACKS.ko.i] = 'let GW_KO=null;';

// ---- surgery 2: drop embedded dict payloads (all dicts fetched lazily as chunks) ----
for (const name of ['const GWDICT_B64=', 'const GWDICT_JA_B64=', 'const GWDICT_KO_B64=']) {
  const i = find(l => l.startsWith(name));
  lines.splice(i, 1);
}

// ---- surgery 3: multi-language chunked loadDict ----
const li = find(l => l.startsWith('function loadDict(lang){'));
const le = find(l => l === '}', li);
const NEW_LOAD = [
  'function loadDict(lang){',
  '  lang = lang || LANG;',
  '  if(DICT_CACHE[lang]) return Promise.resolve(DICT_CACHE[lang]);',
  '  if(DICT_CACHE["!"+lang]) return Promise.resolve(null);',
  '  const n = (window.__gwDictChunks||{})[lang] || 0;',
  '  if(!n) return Promise.resolve(null);',
  '  const jobs=[]; for(let i=0;i<n;i++) jobs.push(window.__gwFetchFile("/data/gwdict-"+lang+"-"+i+".bin?"+window.__gwVER));',
  '  return Promise.all(jobs)',
  '    .then(parts => {',
  '      let total=0; for(const p of parts) total+=p.byteLength;',
  '      const all=new Uint8Array(total); let off=0;',
  '      for(const p of parts){ all.set(new Uint8Array(p), off); off+=p.byteLength; }',
  '      return new Response(new Blob([all]).stream().pipeThrough(new DecompressionStream("gzip"))).text();',
  '    })',
  '    .then(t => { DICT_CACHE[lang] = JSON.parse(t); return DICT_CACHE[lang]; })',
  '    .catch(() => { DICT_CACHE["!"+lang] = true; return null; });',
  '}',
].join('\n');
lines.splice(li, le - li + 1, NEW_LOAD);

// ---- surgery 4: remove boot-time activation (the loader orchestrates after chunks arrive) ----
{
  const i = find(l => l.trim() === 'activateLang(store.settings.lang);');
  lines.splice(i, 1);
}

// ---- surgery 5: defer boot until the initial pack is ready ----
const boi = find(l => l.includes('---------- boot ----------'));
lines.splice(boi + 1, 0, 'function __boot(){');
{
  const ldi = find(l => l === 'loadDict();', boi);
  lines.splice(ldi, 1);
}
const sc = find(l => l === '</script>');
lines.splice(sc, 0, '}');

// ---- write chunks + meta ----
const dictChunks = {};
for (const L of CHUNK_LANGS) {
  const P = PACKS[L].val;
  const vec = Buffer.from(P.vec, 'base64');
  if (vec.length !== P.N * P.D) throw new Error(`${L}: vec size mismatch`);
  const nv = Math.max(1, Math.ceil(vec.length / CHUNK_BYTES));
  for (let i = 0; i < nv; i++) {
    fs.writeFileSync(path.join(OUT, 'data', `gw-${L}-vec-${i}.bin`), vec.subarray(i * CHUNK_BYTES, Math.min((i + 1) * CHUNK_BYTES, vec.length)));
  }
  const gz = DICTS[L];
  const nd = Math.max(1, Math.ceil(gz.length / CHUNK_BYTES));
  dictChunks[L] = nd;
  for (let i = 0; i < nd; i++) {
    fs.writeFileSync(path.join(OUT, 'data', `gwdict-${L}-${i}.bin`), gz.subarray(i * CHUNK_BYTES, Math.min((i + 1) * CHUNK_BYTES, gz.length)));
  }
  if (L !== 'en') {   // en metadata stays embedded in the shell
    fs.writeFileSync(path.join(OUT, 'data', `gw-${L}-meta.json`),
      JSON.stringify({ N: P.N, D: P.D, words: P.words, level: P.level, min: P.min, max: P.max, chunks: nv }));
  }
  console.log(`${L}: vec ${(vec.length / 1048576).toFixed(2)}MB/${nv} chunks | dict ${(gz.length / 1048576).toFixed(2)}MB/${nd} chunks`);
}

// ---- loader overlay + script ----
const OVERLAY = [
  '<div id="bootOv" style="position:fixed;inset:0;z-index:9999;background:#0b0e14;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,\'Segoe UI\',sans-serif">',
  '  <div style="width:min(320px,80vw);text-align:center;color:#c9d4e3">',
  '    <div style="font-size:22px;letter-spacing:.14em;margin-bottom:18px">GUESSWORD</div>',
  '    <div style="height:3px;background:#232a36;border-radius:2px;overflow:hidden"><i id="bootBar" style="display:block;height:100%;width:2%;background:#5b8cff;transition:width .25s"></i></div>',
  '    <div id="bootTxt" style="margin-top:12px;font-size:13px;opacity:.75">正在加载词库…</div>',
  '    <button id="bootRetry" type="button" style="display:none;margin-top:14px;padding:8px 22px;border:1px solid #3a4353;background:transparent;color:#c9d4e3;border-radius:8px;font-size:13px;cursor:pointer">重试</button>',
  '  </div>',
  '</div>',
  '<script>',
  '"use strict";',
  '(function(){',
  `  window.__gwVER=${JSON.stringify(VER)}; window.__gwDictChunks=${JSON.stringify(dictChunks)};`,
  `  var CN="gwd-data-v2", SECHOST=${JSON.stringify(SECHOST)}, LANGS=["en","ja","ko","fr","de","es"];`,
  '  var BASES=[location.origin];',
  '  if(SECHOST && SECHOST!==location.origin) BASES.push(SECHOST);',
  '  var bar=document.getElementById("bootBar"), txt=document.getElementById("bootTxt"), retry=document.getElementById("bootRetry"), ov=document.getElementById("bootOv");',
  '  function prog(f,m){ bar.style.width=Math.max(2,Math.round(f*100))+"%"; if(m) txt.textContent=m; }',
  '  function copen(){ return caches.open(CN); }',
  '  function attempt(base,path){',
  '    var ctl=new AbortController(); var timer=setTimeout(function(){ ctl.abort(); },40000);',
  '    return fetch(base+path,{signal:ctl.signal}).then(function(r){',
  '      clearTimeout(timer);',
  '      if(!r.ok) throw new Error("HTTP "+r.status);',
  '      return r.arrayBuffer();',
  '    },function(e){ clearTimeout(timer); throw e; });',
  '  }',
  '  window.__gwFetchFile = function(path){',
  '    return copen().then(function(c){ return c.match(path); }).then(function(m){',
  '      if(m) return m.arrayBuffer();',
  '      var tries=0;',
  '      function next(){',
  '        var base=BASES[tries%BASES.length]; tries++;',
  '        return attempt(base,path).then(function(b){',
  '          try{ copen().then(function(c){ c.put(path, new Response(b.slice(0))); }); }catch(e){}',
  '          return b;',
  '        },function(e){',
  '          if(tries>=BASES.length+2) throw e;',
  '          return new Promise(function(res){ setTimeout(res,700); }).then(next);',
  '        });',
  '      }',
  '      return next();',
  '    });',
  '  };',
  '  function fetchJson(path){ return window.__gwFetchFile(path).then(function(b){ return JSON.parse(new TextDecoder().decode(b)); }); }',
  '  function setPack(L, obj){',
  '    if(L==="en"){ GWD.vec=obj.vec; }',
  '    else if(L==="ja"){ GW_JA=obj; }',
  '    else if(L==="ko"){ GW_KO=obj; }',
  '    else if(L==="fr"){ GW_FR=obj; }',
  '    else if(L==="de"){ GW_DE=obj; }',
  '    else if(L==="es"){ GW_ES=obj; }',
  '  }',
  '  function loadPack(L, onProg){',
  '    var metaP = (L==="en") ? Promise.resolve(null) : fetchJson("/data/gw-"+L+"-meta.json?"+window.__gwVER);',
  '    return metaP.then(function(meta){',
  '      var CH = meta ? meta.chunks : ' + Math.max(1, Math.ceil(vecEn.length / CHUNK_BYTES)) + ';',
  '      var done=0, parts=new Array(CH), jobs=[];',
  '      for(var i=0;i<CH;i++) jobs.push(i);',
  '      return Promise.all(jobs.map(function(i){',
  '        return window.__gwFetchFile("/data/gw-"+L+"-vec-"+i+".bin?"+window.__gwVER).then(function(b){',
  '          parts[i]=new Uint8Array(b); done++;',
  '          if(onProg) onProg(done/CH);',
  '        });',
  '      })).then(function(){',
  '        var total=0; for(var i=0;i<CH;i++) total+=parts[i].length;',
  '        var all=new Uint8Array(total), off=0;',
  '        for(var i=0;i<CH;i++){ all.set(parts[i],off); off+=parts[i].length; }',
  '        var obj = meta ? Object.assign({}, meta, {vec: all}) : {vec: all};',
  '        setPack(L, obj);',
  '        return L;',
  '      });',
  '    });',
  '  }',
  '  window.__loadLang = function(L, onProg){',
  '    if(LANGS.indexOf(L)<0) return Promise.reject(new Error("unknown lang"));',
  '    if((L!=="en" && (window["__gwp_"+L])) ) return Promise.resolve(L);',
  '    return loadPack(L, onProg).then(function(){ window["__gwp_"+L]=1; return L; });',
  '  };',
  '  function initialLang(){',
  '    try{ var st=JSON.parse(localStorage.getItem("guessword-v2")||"{}");',
  '      if(st && st.settings && LANGS.indexOf(st.settings.lang)>=0) return st.settings.lang;',
  '    }catch(e){}',
  '    return "en";',
  '  }',
  '  function fail(){',
  '    var n=0;',
  '    try{ n=parseInt(sessionStorage.getItem("gwdReloads")||"0",10)||0; }catch(e){}',
  '    if(n<2){',
  '      try{ sessionStorage.setItem("gwdReloads", String(n+1)); }catch(e){}',
  '      txt.textContent="网络波动,自动重试…";',
  '      setTimeout(function(){ location.reload(); }, 1200);',
  '    }else{',
  '      retry.style.display="inline-block";',
  '      txt.textContent="加载失败,请检查网络后重试";',
  '    }',
  '  }',
  '  function run(L){',
  '    retry.style.display="none"; prog(0.02,"正在加载词库…");',
  '    loadPack(L, function(f){ prog(0.03+f*0.93, "正在加载词库 "+Math.round(f*100)+"%"); }).then(function(){',
  '      if(L!=="en") window["__gwp_"+L]=1;',
  '      prog(0.98,"启动中…");',
  '      activateLang(L);',
  '      __boot();',
  '      prog(1,"完成");',
  '      try{ sessionStorage.removeItem("gwdReloads"); }catch(e){}',
  '      setTimeout(function(){ ov.style.display="none"; }, 150);',
  '    }).catch(function(e){ console.error(e); fail(); });',
  '  }',
  '  retry.addEventListener("click", function(){ try{ sessionStorage.removeItem("gwdReloads"); }catch(e){} run(initialLang()); });',
  '  run(initialLang());',
  '})();',
  '<\/script>',
].join('\n');
const bbody = find(l => l === '</body>');
lines.splice(bbody, 0, OVERLAY);

fs.writeFileSync(path.join(OUT, 'index.html'), lines.join('\n'));
fs.writeFileSync(path.join(OUT, '_headers'),
  '/data/*\n  Cache-Control: public, max-age=31536000, immutable\n  Access-Control-Allow-Origin: *\n');
fs.copyFileSync(WRANGLER_TOML, path.join(OUT, 'wrangler.toml'));

const st = p => (fs.statSync(p).size / 1048576).toFixed(2) + 'MB';
console.log('index.html:', st(path.join(OUT, 'index.html')), '| SECHOST:', SECHOST || '(same-origin)');
console.log('data files:', fs.readdirSync(path.join(OUT, 'data')).length);
