import json, time
from patchright.sync_api import sync_playwright

import sys
URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8137/"
result = {}
errs = []

# Main-world bridge: copy __gw.answer into a DOM attribute so isolated-world evaluate can read it.
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

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--no-proxy-server"])
    pg = b.new_page()
    pg.add_init_script(INIT)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append("console-error: " + m.text) if m.type == "error" else None)

    BOOTWAIT = "document.getElementById('dictCount') && document.getElementById('dictCount').textContent !== '…'"

    # ---- first load (cold) ----
    t0 = time.time()
    pg.goto(URL, wait_until="domcontentloaded")
    pg.wait_for_function(BOOTWAIT, timeout=120000)
    result["boot1_cold_sec"] = round(time.time() - t0, 2)
    pg.wait_for_timeout(400)
    result["boot1"] = pg.evaluate("""() => ({
        bootOvDisplay: (document.getElementById('bootOv')||{style:{}}).style.display || 'unset',
        dictCount: document.getElementById('dictCount').textContent,
        cacheReady: caches.has('gwd-data-v1')
    })""")

    # ---- home -> setup -> start ----
    pg.evaluate("document.getElementById('startBtn').click()")
    pg.wait_for_timeout(300)
    result["setupCards"] = pg.evaluate("document.querySelectorAll('.lvCard').length")
    pg.evaluate("document.querySelectorAll('.lvCard')[1].click()")
    pg.wait_for_timeout(200)
    pg.evaluate("document.querySelectorAll('.lvCard')[1].click()")  # same card twice = single-level range
    pg.wait_for_timeout(200)
    pg.evaluate("document.getElementById('beginBtn').click()")
    pg.wait_for_timeout(900)
    result["gameInputEnabled"] = pg.evaluate("!document.getElementById('guessInput').disabled")

    # ---- try instant win via bridged secret, else guess+giveup ----
    secret = None
    try:
        handle = pg.wait_for_function("document.documentElement.getAttribute('data-gw-answer')", timeout=6000)
        secret = handle.json_value()
        result["secretViaBridge"] = True
    except Exception:
        result["secretViaBridge"] = False

    if secret:
        pg.fill("#guessInput", secret)
        pg.press("#guessInput", "Enter")
        pg.wait_for_timeout(2500)
    else:
        pg.fill("#guessInput", "about")
        pg.press("#guessInput", "Enter")
        pg.wait_for_timeout(1500)
        result["rowAfterGuess"] = pg.evaluate("(document.querySelector('#board .row:last-child')||{innerText:''}).innerText.replace(/\\n+/g,' | ').slice(0,100)")
        pg.evaluate("document.getElementById('menuBtn').click()")
        pg.wait_for_timeout(250)
        pg.evaluate("document.getElementById('giveupItem').click()")
        pg.wait_for_timeout(400)
        pg.evaluate("document.getElementById('confirmYes').click()")
        pg.wait_for_timeout(2000)

    result["results"] = pg.evaluate("""() => ({
        resWord: (document.getElementById('resWord')||{}).textContent || null,
        boardRows: document.querySelectorAll('#board .row').length
    })""")

    # ---- dict via result word click (lazy 8.5MB fetch) ----
    pg.evaluate("document.getElementById('resWord').click()")
    pg.wait_for_timeout(400)
    try:
        pg.wait_for_function("""() => {
            const el = document.getElementById('dlEntry');
            return el && el.innerText && el.innerText.length > 40 && !/加载中/.test(el.innerText);
        }""", timeout=120000)
        result["dict"] = {"loaded": True, "sample": pg.evaluate("document.getElementById('dlEntry').innerText.replace(/\\n+/g,' | ').slice(0,240)")}
    except Exception:
        result["dict"] = {"loaded": False, "sample": pg.evaluate("(document.getElementById('dlEntry')||{innerText:''}).innerText.slice(0,160)")}
    pg.evaluate("document.getElementById('dlClose') && document.getElementById('dlClose').click()")
    pg.wait_for_timeout(200)

    # ---- history ----
    pg.evaluate("document.getElementById('histHomeBtn').click()")
    pg.wait_for_timeout(400)
    result["history"] = pg.evaluate("""() => ({
        open: document.getElementById('histOverlay').classList.contains('open'),
        items: document.querySelectorAll('.histItem').length,
        firstRow: (document.querySelector('.histItem')||{innerText:''}).innerText.replace(/\\n+/g,' | ').slice(0,150)
    })""")

    # ---- cache entries ----
    result["cacheEntries"] = pg.evaluate("caches.open('gwd-data-v1').then(c => c.keys()).then(ks => ks.length)")

    # ---- second load: boot from Cache API ----
    t1 = time.time()
    pg.reload(wait_until="domcontentloaded")
    pg.wait_for_function(BOOTWAIT, timeout=30000)
    result["boot2_cached_sec"] = round(time.time() - t1, 2)

    b.close()

print(json.dumps(result, ensure_ascii=False, indent=1))
print("PAGE_ERRORS:", json.dumps(errs[:12], ensure_ascii=False))
