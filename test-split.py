"""Regression test for the split source / autocomplete fix / language-aware placeholder.
usage: python test-split.py [url]   (default http://127.0.0.1:8140/index.html = split source)
"""
import json, sys, time
from patchright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8140/index.html"
result, errs = {}, []

INIT = """
setInterval(function(){
  try{
    var a = window.__gw && window.__gw.answer;
    if (a && document.documentElement.getAttribute('data-gw-answer') !== a)
      document.documentElement.setAttribute('data-gw-answer', a);
  }catch(e){}
}, 150);
"""

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page()
    pg.add_init_script(INIT)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append("console-error: " + m.text) if m.type == "error" else None)

    t0 = time.time()
    pg.goto(URL, wait_until="domcontentloaded")
    pg.wait_for_function("document.getElementById('dictCount') && document.getElementById('dictCount').textContent !== '…'", timeout=60000)
    result["boot_sec"] = round(time.time() - t0, 2)
    result["dictCount"] = pg.evaluate("document.getElementById('dictCount').textContent")
    result["langButtons"] = pg.evaluate("[...document.querySelectorAll('.langBtn')].map(b=>b.textContent)")

    # ---- start an English game ----
    pg.evaluate("document.getElementById('startBtn').click()")
    pg.wait_for_timeout(250)
    pg.evaluate("document.querySelectorAll('.lvCard')[0].click()")
    pg.wait_for_timeout(150)
    pg.evaluate("document.querySelectorAll('.lvCard')[1].click()")
    pg.wait_for_timeout(150)
    pg.evaluate("document.getElementById('beginBtn').click()")
    pg.wait_for_timeout(900)
    result["placeholder_en"] = pg.evaluate("document.getElementById('guessInput').placeholder")

    # ---- autocomplete: type, click the first suggestion ----
    pg.fill("#guessInput", "abou")
    pg.wait_for_timeout(400)
    result["acItems_en"] = pg.evaluate("[...document.querySelectorAll('#acBox .acItem')].map(e=>e.innerText.trim())")
    pg.evaluate("document.querySelector('#acBox .acItem').click()")
    pg.wait_for_timeout(300)
    result["acClickValue_en"] = pg.evaluate("document.getElementById('guessInput').value")
    pg.press("#guessInput", "Enter")
    pg.wait_for_timeout(1200)
    result["boardRowAfterClick"] = pg.evaluate("(document.querySelector('#board .row:last-child')||{innerText:''}).innerText.replace(/\\n+/g,' | ').slice(0,120)")
    result["acClickValid_en"] = result["acClickValue_en"] not in ("", "undefined") and result["acClickValue_en"].isascii()

    # ---- second guess by keyboard Tab (pickAc path) ----
    pg.fill("#guessInput", "whi")
    pg.wait_for_timeout(300)
    pg.press("#guessInput", "Tab")
    pg.wait_for_timeout(150)
    result["acTabValue_en"] = pg.evaluate("document.getElementById('guessInput').value")

    # ---- switch to Japanese, placeholder + autocomplete ----
    pg.evaluate("[...document.querySelectorAll('.langBtn')].find(b=>b.dataset.lang==='ja').click()")
    pg.wait_for_function("() => { const b=[...document.querySelectorAll('.langBtn')].find(x=>x.dataset.lang==='ja'); return b && b.classList.contains('on'); }", timeout=60000)
    pg.wait_for_timeout(1200)
    result["placeholder_ja"] = pg.evaluate("document.getElementById('guessInput').placeholder")
    pg.evaluate("document.getElementById('startBtn').click()")
    pg.wait_for_timeout(250)
    pg.evaluate("document.querySelectorAll('.lvCard')[0].click()")
    pg.wait_for_timeout(150)
    pg.evaluate("document.querySelectorAll('.lvCard')[0].click()")
    pg.wait_for_timeout(150)
    pg.evaluate("document.getElementById('beginBtn').click()")
    pg.wait_for_timeout(900)
    result["placeholder_ja_game"] = pg.evaluate("document.getElementById('guessInput').placeholder")
    pg.fill("#guessInput", "あ")
    pg.wait_for_timeout(400)
    result["acItems_ja"] = pg.evaluate("[...document.querySelectorAll('#acBox .acItem')].map(e=>e.innerText.trim()).slice(0,5)")
    if result["acItems_ja"]:
        pg.evaluate("document.querySelector('#acBox .acItem').click()")
        pg.wait_for_timeout(300)
        result["acClickValue_ja"] = pg.evaluate("document.getElementById('guessInput').value")
        result["acClickValid_ja"] = result["acClickValue_ja"] not in ("", "undefined")

    # ---- warning message for wrong-language input ----
    pg.fill("#guessInput", "hello")
    pg.press("#guessInput", "Enter")
    pg.wait_for_timeout(600)
    result["msg_ja_wronglang"] = pg.evaluate("(document.getElementById('resultArea')||{innerText:''}).innerText.trim()")

    # ---- dictionary in Japanese: expect Chinese translation line ----
    pg.evaluate("document.getElementById('dlHomeBtn').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("document.getElementById('dlSearch').value='酒'; document.getElementById('dlGo').click()")
    pg.wait_for_timeout(1500)
    result["dict_ja"] = pg.evaluate("document.getElementById('dlEntry').innerText.replace(/\\n+/g,' | ').slice(0,300)")
    result["dict_ja_zh"] = pg.evaluate("""() => {
        const defs=[...document.querySelectorAll('#dlEntry .dlDef')].map(e=>e.innerText);
        const cjk=defs.filter(t=>/[\\u4e00-\\u9fff]/.test(t));
        return {defs: defs.length, withZh: cjk.length, first: (cjk[0]||'').slice(0,60),
                sub: document.querySelectorAll('#dlEntry .dlDefSub').length,
                src: (document.querySelector('#dlEntry .dlSrc')||{innerText:''}).innerText};
    }""")

    # ---- dictionary in Korean: headword Chinese + senses ----
    pg.evaluate("document.getElementById('dlClose').click()")
    pg.wait_for_timeout(200)
    pg.evaluate("document.querySelector('.langBtn[data-lang=\"ko\"]').click()")
    pg.wait_for_timeout(1500)
    pg.evaluate("document.getElementById('dlHomeBtn').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("document.getElementById('dlSearch').value='이름'; document.getElementById('dlGo').click()")
    pg.wait_for_timeout(1500)
    result["dict_ko"] = pg.evaluate("document.getElementById('dlEntry').innerText.replace(/\\n+/g,' | ').slice(0,240)")

    b.close()

print(json.dumps(result, ensure_ascii=False, indent=1))
print("PAGE_ERRORS:", json.dumps(errs[:10], ensure_ascii=False))
