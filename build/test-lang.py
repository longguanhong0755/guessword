import json, sys
from patchright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8137/guessword.html"
FULL = len(sys.argv) > 2 and sys.argv[2] == "full"

INIT = """
setInterval(function(){
  try{
    var a = window.__gw && window.__gw.answer;
    if (a && document.documentElement.getAttribute('data-gw-answer') !== a) {
      document.documentElement.setAttribute('data-gw-answer', a);
    }
  }catch(e){}
}, 150);
"""


def wait_lang_load(pg, lang, timeout_s=180):
    pg.wait_for_function(
        "() => { const b=document.querySelector('.langBtn[data-lang=\"%s\"]'); return b && !b.classList.contains('busy') && b.classList.contains('on'); }" % lang,
        timeout=timeout_s*1000)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--no-proxy-server"])
    pg = b.new_page()
    pg.add_init_script(INIT)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:300]))
    pg.on("console", lambda m: errs.append("console: " + m.text[:200]) if m.type == "error" else None)
    pg.goto(URL, wait_until="domcontentloaded")
    pg.wait_for_function("document.getElementById('dictCount') && document.getElementById('dictCount').textContent !== '…'", timeout=120000)
    pg.wait_for_timeout(500)

    print("langs in row:", pg.evaluate("[...document.querySelectorAll('.langBtn')].map(b=>b.textContent).join(' / ')"))

    # switch to Japanese
    pg.evaluate("document.querySelector('.langBtn[data-lang=\"ja\"]').click()")
    wait_lang_load(pg, "ja")
    print("after ja switch: dictCount=", pg.evaluate("document.getElementById('dictCount').textContent"))

    # start setup, pick N5+N4 (indices 0,1), begin
    pg.evaluate("document.getElementById('startBtn').click()")
    pg.wait_for_timeout(400)
    print("lv cards:", pg.evaluate("[...document.querySelectorAll('.lvCard .nm')].map(x=>x.textContent).join(',')"))
    pg.evaluate("document.querySelectorAll('.lvCard')[0].click()")
    pg.wait_for_timeout(200)
    pg.evaluate("document.querySelectorAll('.lvCard')[1].click()")
    pg.wait_for_timeout(200)
    print("range label:", pg.evaluate("document.getElementById('lvInfo').textContent.slice(0,80)"))
    pg.evaluate("document.getElementById('beginBtn').click()")
    pg.wait_for_timeout(800)
    print("badge:", pg.evaluate("document.getElementById('modeBadge').textContent"))
    print("input enabled:", pg.evaluate("!document.getElementById('guessInput').disabled"))

    # get secret via bridge
    sec = pg.evaluate("document.documentElement.getAttribute('data-gw-answer')")
    print("secret(ja):", sec)

    # guess the secret directly -> win
    pg.fill("#guessInput", sec)
    pg.press("#guessInput", "Enter")
    pg.wait_for_timeout(2500)
    print("resWord:", pg.evaluate("(document.getElementById('resWord')||{}).textContent || null"))

    # dictionary on the secret (ja entry with reading?)
    pg.evaluate("document.getElementById('resWord').click()")
    pg.wait_for_timeout(600)
    try:
        pg.wait_for_function("""() => { const el = document.getElementById('dlEntry'); return el && el.innerText && el.innerText.length > 5 && !/加载中/.test(el.innerText); }""", timeout=30000)
    except Exception:
        pass
    print("dict:", pg.evaluate("document.getElementById('dlEntry').innerText.replace(/\\n+/g,' | ').slice(0,180)"))
    pg.evaluate("document.getElementById('dlClose').click()")
    pg.wait_for_timeout(300)

    # history shows the game with language tag
    pg.evaluate("document.getElementById('histHomeBtn').click()")
    pg.wait_for_timeout(500)
    print("history first row:", pg.evaluate("(document.querySelector('.histItem .histRow')||{innerText:''}).innerText.replace(/\\n+/g,' | ').slice(0,120)"))
    pg.evaluate("document.getElementById('histClose').click()")
    pg.wait_for_timeout(300)

    # master shows en/ja/ko; the full variant shows all six
    print("lang buttons after all:", pg.evaluate("[...document.querySelectorAll('.langBtn')].map(b=>b.dataset.lang).join(',')"))
    if FULL:
        pg.evaluate("document.querySelector('.langBtn[data-lang=\"fr\"]').click()")
        wait_lang_load(pg, "fr")
        print("after fr switch: dictCount=", pg.evaluate("document.getElementById('dictCount').textContent"))
        pg.evaluate("document.getElementById('startBtn').click()")
        pg.wait_for_timeout(500)
        print("fr lv cards:", pg.evaluate("[...document.querySelectorAll('.lvCard .nm')].map(x=>x.textContent).join(',')"))
        pg.evaluate("document.getElementById('backHome').click()")
        pg.wait_for_timeout(200)
        pg.evaluate("document.getElementById('dlHomeBtn').click()")
        pg.wait_for_timeout(600)
        pg.fill("#dlSearch", "chien")
        pg.evaluate("document.getElementById('dlGo').click()")
        pg.wait_for_timeout(9000)
        print("fr dict chien:", pg.evaluate("document.getElementById('dlEntry').innerText.replace(/\\n+/g,' | ').slice(0,140)"))
        pg.evaluate("document.getElementById('dlClose').click()")
        pg.wait_for_timeout(200)
        # switch to German and Korean for smoke
        pg.evaluate("document.querySelector('.langBtn[data-lang=\"de\"]').click()")
        wait_lang_load(pg, "de")
        print("after de switch: dictCount=", pg.evaluate("document.getElementById('dictCount').textContent"))
        pg.evaluate("document.querySelector('.langBtn[data-lang=\"ko\"]').click()")
        wait_lang_load(pg, "ko")
        print("after ko switch: dictCount=", pg.evaluate("document.getElementById('dictCount').textContent"))
    print("PAGE_ERRORS:", json.dumps(errs[:8], ensure_ascii=False))
    b.close()
