// Build the split/parallel-load deploy variant of GuessWord from the single-file master.
// Master stays untouched; output goes to D:/gw-deploy-site/ (index.html + data/* + _headers).
// Usage: node build-variant.mjs [secondary-data-origin]
//   Secondary origin (e.g. https://<hash>.guessword-173.pages.dev) lets the browser open a
//   second TCP flow for chunk downloads (~2x cold-boot throughput on lossy links).
import fs from 'node:fs';
import path from 'node:path';

const MASTER = 'D:/workspace/guessword/guessword.html';
const OUT = 'D:/workspace/guessword/site';
const WRANGLER_TOML = 'D:/workspace/guessword/wrangler.toml';
const VER = 'v20261010b';   // bump on data change to bust immutable caches
const CHUNKS = 8;
const SECHOST = (process.argv[2] || '').replace(/\/$/, '');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });

const src = fs.readFileSync(MASTER, 'utf8');
const lines = src.split('\n');
const find = (pred, from = 0) => {
  for (let i = from; i < lines.length; i++) if (pred(lines[i])) return i;
  throw new Error('marker not found: ' + pred);
};

// ---- extract GWD ----
const gi = find(l => l.startsWith('const GWD='));
const GWD = JSON.parse(lines[gi].slice('const GWD='.length).replace(/;\s*$/, ''));
const vec = Buffer.from(GWD.vec, 'base64');
if (vec.length !== GWD.N * GWD.D) throw new Error(`vec size ${vec.length} != ${GWD.N * GWD.D}`);

// ---- extract dict gzip ----
const di = find(l => l.startsWith('const GWDICT_B64='));
const dm = /^const GWDICT_B64="([A-Za-z0-9+/=]+)";?\s*$/.exec(lines[di]);
if (!dm) throw new Error('GWDICT line format unexpected');
const dictGz = Buffer.from(dm[1], 'base64');
if (dictGz[0] !== 0x1f || dictGz[1] !== 0x8b) throw new Error('dict payload is not gzip');

// ---- surgery 1: GWD line without vec ----
lines[gi] = 'const GWD=' + JSON.stringify({ N: GWD.N, D: GWD.D, words: GWD.words, level: GWD.level, min: GWD.min, max: GWD.max }) + ';';

// ---- surgery 2: async vec decode ----
const ai = find(l => l.startsWith('const __b64 = atob(GWD.vec);'));
if (!lines[ai + 1].startsWith('const __bytes') || !lines[ai + 2].startsWith('for(let i=0')) throw new Error('decode block mismatch');
lines.splice(ai, 3, 'let __bytes = null;');

// ---- surgery 3: wrap UNIT build into __buildUnit() ----
const ui = find(l => l.startsWith('const UNIT = new Float32Array(N*D);'));
lines[ui] = 'let UNIT = null;\nfunction __buildUnit(){\n  const UNIT = new Float32Array(N*D);';
const bi = find(l => l === '}', ui); // bare closing brace of the UNIT block
lines.splice(bi + 1, 0, '  return UNIT;', '}');

// ---- surgery 4: loadDict fetches lazily with cache (chunked, like the vec) ----
const li = find(l => l.startsWith('function loadDict(){'));
const le = find(l => l === '}', li);
const DICT_CHUNKS = 6;
const NEW_LOAD = [
  'function loadDict(){',
  '  if(DICT) return Promise.resolve(DICT);',
  '  if(DICT_BAD) return Promise.resolve(null);',
  `  const jobs=[]; for(let i=0;i<${DICT_CHUNKS};i++) jobs.push(window.__gwFetchFile("/data/gwdict-"+i+".bin?${VER}"));`,
  '  return Promise.all(jobs)',
  '    .then(parts => {',
  '      let total=0; for(const p of parts) total+=p.byteLength;',
  '      const all=new Uint8Array(total); let off=0;',
  '      for(const p of parts){ all.set(new Uint8Array(p), off); off+=p.byteLength; }',
  '      return new Response(new Blob([all]).stream().pipeThrough(new DecompressionStream("gzip"))).text();',
  '    })',
  '    .then(t => { DICT = JSON.parse(t); return DICT; })',
  '    .catch(() => { DICT_BAD = true; return null; });',
  '}',
].join('\n');
lines.splice(li, le - li + 1, NEW_LOAD);

// ---- surgery 4b: drop the embedded dict payload (fetched lazily now) ----
const di2 = find(l => l.startsWith('const GWDICT_B64='));
lines.splice(di2, 1);

// ---- surgery 5: defer boot until vec is ready ----
const boi = find(l => l.includes('---------- boot ----------'));
lines.splice(boi + 1, 0, 'function __boot(){');
const ldi = find(l => l === 'loadDict();', boi); // eager dict prewarm removed (lazy now)
lines.splice(ldi, 1);
const sc = find(l => l === '</script>');
lines.splice(sc, 0, '}');

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
  `  var VER=${JSON.stringify(VER)}, CH=${CHUNKS}, CN="gwd-data-v1", SECHOST=${JSON.stringify(SECHOST)};`,
  '  var BASES=[location.origin];',
  '  if(SECHOST && SECHOST!==location.origin) BASES.push(SECHOST);',
  '  var bar=document.getElementById("bootBar"), txt=document.getElementById("bootTxt"), retry=document.getElementById("bootRetry"), ov=document.getElementById("bootOv");',
  '  function prog(f,m){ bar.style.width=Math.max(2,Math.round(f*100))+"%"; if(m) txt.textContent=m; }',
  '  function copen(){ return caches.open(CN); }',
  '  function attempt(base,path){',
  '    return fetch(base+path).then(function(r){',
  '      if(!r.ok) throw new Error("HTTP "+r.status);',
  '      return r.arrayBuffer();',
  '    });',
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
  '  function run(){',
  '    retry.style.display="none"; prog(0.02,"正在加载词库…");',
  '    var done=0, parts=new Array(CH), jobs=[];',
  '    for(var i=0;i<CH;i++) jobs.push(i);',
  '    Promise.all(jobs.map(function(i){',
  '      return window.__gwFetchFile("/data/gwd-vec-"+i+".bin?"+VER).then(function(b){',
  '        parts[i]=new Uint8Array(b); done++; prog(done/CH*0.96, "正在加载词库 "+done+"/"+CH);',
  '      });',
  '    })).then(function(){',
  '      var total=0; for(var i=0;i<CH;i++) total+=parts[i].length;',
  '      var all=new Uint8Array(total), off=0;',
  '      for(var i=0;i<CH;i++){ all.set(parts[i],off); off+=parts[i].length; }',
  '      prog(0.99,"启动中…");',
  '      __bytes = all;',
  '      UNIT = __buildUnit();',
  '      __boot();',
  '      prog(1,"完成");',
  '      try{ sessionStorage.removeItem("gwdReloads"); }catch(e){}',
  '      setTimeout(function(){ ov.style.display="none"; }, 150);',
  '    }).catch(function(e){ console.error(e); fail(); });',
  '  }',
  '  retry.addEventListener("click", function(){ try{ sessionStorage.removeItem("gwdReloads"); }catch(e){} run(); });',
  '  run();',
  '})();',
  '<\/script>',
].join('\n');
const bbody = find(l => l === '</body>');
lines.splice(bbody, 0, OVERLAY);

fs.writeFileSync(path.join(OUT, 'index.html'), lines.join('\n'));

// ---- data chunks ----
const per = Math.ceil(vec.length / CHUNKS);
for (let i = 0; i < CHUNKS; i++) {
  fs.writeFileSync(path.join(OUT, 'data', `gwd-vec-${i}.bin`), vec.subarray(i * per, Math.min((i + 1) * per, vec.length)));
}
const dper = Math.ceil(dictGz.length / DICT_CHUNKS);
for (let i = 0; i < DICT_CHUNKS; i++) {
  fs.writeFileSync(path.join(OUT, 'data', `gwdict-${i}.bin`), dictGz.subarray(i * dper, Math.min((i + 1) * dper, dictGz.length)));
}
fs.writeFileSync(path.join(OUT, '_headers'),
  '/data/*\n  Cache-Control: public, max-age=31536000, immutable\n  Access-Control-Allow-Origin: *\n');
fs.copyFileSync(WRANGLER_TOML, path.join(OUT, 'wrangler.toml'));

const st = p => (fs.statSync(p).size / 1048576).toFixed(2) + 'MB';
console.log('index.html:', st(path.join(OUT, 'index.html')), '| SECHOST:', SECHOST || '(same-origin)');
console.log('vec chunks:', CHUNKS, '| vec total =', vec.length, '| dict chunks:', DICT_CHUNKS, '| dict total:', dictGz.length);
