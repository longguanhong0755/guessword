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
    var g = window.__gw; if(!g) return;
    var d = document.documentElement;
    var a = g.answer;
    if (a && d.getAttribute('data-gw-answer') !== a)
      d.setAttribute('data-gw-answer', a);
    if (!d.getAttribute('data-gw-words') && g.sampleWords){
      var s = g.sampleWords(120);
      if (s && s.length) d.setAttribute('data-gw-words', JSON.stringify(s));
    }
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

    # ---- dictionary fallback: unknown word -> external link (NAVER for Korean) ----
    pg.evaluate("document.getElementById('dlSearch').value='zzzzzz'; document.getElementById('dlGo').click()")
    pg.wait_for_function("!!document.querySelector('#dlEntry .dlExt')", timeout=20000)
    result["dict_fallback"] = pg.evaluate("""(() => {
        const a = document.querySelector('#dlEntry .dlExt');
        return {text: document.getElementById('dlEntry').innerText.replace(/\\n+/g,' | ').slice(0,80), href: a.href};
    })()""")


    # ---- results screen: rank curve of this game's guesses (local engine) ----
    pg.evaluate("document.getElementById('dlClose').click()")
    pg.wait_for_timeout(250)
    pg.evaluate("document.getElementById('homeBtn').click()")
    pg.wait_for_timeout(350)
    if pg.evaluate("document.getElementById('confirmOverlay').classList.contains('open')"):
        pg.evaluate("document.getElementById('confirmYes').click()")
        pg.wait_for_timeout(500)
    pg.evaluate("document.getElementById('resumeBtn').click()")
    pg.wait_for_timeout(1500)
    pg.evaluate("document.getElementById('menuBtn').click()")
    pg.wait_for_timeout(250)
    pg.evaluate("document.getElementById('giveupItem').click()")
    pg.wait_for_timeout(250)
    pg.evaluate("document.getElementById('confirmYes').click()")
    pg.wait_for_function("document.getElementById('resultsView').style.display === 'block'", timeout=30000)
    pg.wait_for_timeout(400)
    result["rank_chart"] = pg.evaluate("""(() => ({
        hasSvg: !!document.querySelector('#rankChart svg'),
        points: document.querySelectorAll('#rankChart .rcDot, #rankChart .rcHint, #rankChart .rcWin').length,
        boardRows: document.querySelectorAll('#board .row').length,
        firstTip: (document.querySelector('#rankChart title')||{textContent:''}).textContent
    }))()""")

    # ---- long game (30+ guesses): the rank curve widens and scrolls instead of crowding ----
    pg.evaluate("document.querySelector('.langBtn[data-lang=\"en\"]').click()")
    pg.wait_for_timeout(700)
    pg.evaluate("document.getElementById('startBtn').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("document.querySelectorAll('.lvCard')[0].click()")
    pg.wait_for_timeout(150)
    pg.evaluate("document.querySelectorAll('.lvCard')[0].click()")
    pg.wait_for_timeout(150)
    pg.evaluate("document.getElementById('beginBtn').click()")
    pg.wait_for_timeout(900)
    pairs = json.loads(pg.evaluate("document.documentElement.getAttribute('data-gw-words') || '[]'"))
    STOP = set("the a an and or but is are was were be been being have has had do does did will would could should may might must can i you he she it we they".split())
    BAD = ("rape", "rapes", "retard", "retards", "nigga", "niggas", "nigger", "niggers",
           "faggot", "faggots", "negro", "coon", "kike", "spastic")
    cand = [w for w, lv in pairs
            if lv >= 2 and len(w) >= 3 and w.isascii() and w.isalpha()
            and w not in STOP and not w.startswith(BAD)]
    ok = 0
    for w in cand:
        if ok >= 32:
            break
        pg.fill("#guessInput", w)
        pg.press("#guessInput", "Enter")
        try:
            pg.wait_for_function("document.querySelectorAll('#board .row').length >= %d" % (ok + 1), timeout=8000)
            ok += 1
        except Exception:
            pass   # folded duplicate or rejected word: skip it
    result["long_game_guesses"] = ok
    pg.evaluate("document.getElementById('menuBtn').click()")
    pg.wait_for_timeout(250)
    pg.evaluate("document.getElementById('giveupItem').click()")
    pg.wait_for_timeout(250)
    pg.evaluate("document.getElementById('confirmYes').click()")
    pg.wait_for_function("document.getElementById('resultsView').style.display === 'block'", timeout=30000)
    pg.wait_for_timeout(400)
    result["dense_chart"] = pg.evaluate("""(() => {
        const svg = document.querySelector('#rankChart svg');
        const chart = document.getElementById('rankChart');
        return {
            hasSvg: !!svg,
            points: document.querySelectorAll('#rankChart .rcDot, #rankChart .rcHint, #rankChart .rcWin').length,
            boardRows: document.querySelectorAll('#board .row').length,
            svgWidth: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
            scrollable: chart.scrollWidth > chart.clientWidth + 4,
            xTicks: document.querySelectorAll('#rankChart .rcX').length
        };
    })()""")

    # ---- daily challenge (offline): same word within the day, first run = official ----
    pg.evaluate("document.getElementById('homeBtn').click()")
    pg.wait_for_timeout(400)
    pg.evaluate("document.getElementById('dailyBtn').click()")
    pg.wait_for_function("document.querySelector('.screen.on').id === 'game' && document.querySelectorAll('#board .row').length === 0", timeout=30000)
    pg.wait_for_timeout(600)
    d1 = pg.evaluate("document.documentElement.getAttribute('data-gw-answer')")
    result["daily_offline_word"] = d1
    pg.fill("#guessInput", d1)
    pg.press("#guessInput", "Enter")
    pg.wait_for_function("document.querySelectorAll('#board .row').length >= 1", timeout=30000)
    pg.evaluate("document.getElementById('resWord').textContent = ''")
    pg.wait_for_function("(document.getElementById('resWord')||{}).textContent.length > 0", timeout=30000)
    pg.evaluate("document.getElementById('homeBtn').click()")
    pg.wait_for_timeout(400)
    result["daily_btn_done"] = pg.evaluate("document.getElementById('dailyBtn').innerText")
    pg.evaluate("document.getElementById('dailyBtn').click()")
    pg.wait_for_function("document.querySelector('.screen.on').id === 'game' && document.querySelectorAll('#board .row').length === 0", timeout=30000)
    pg.wait_for_timeout(600)
    result["daily_offline_stable"] = (pg.evaluate("document.documentElement.getAttribute('data-gw-answer')") == d1)
    # cross-game stats strip in the history dialog
    pg.evaluate("document.getElementById('histHomeBtn').click()")
    pg.wait_for_timeout(400)
    result["hist_stats"] = pg.evaluate("document.getElementById('histStats').innerText.replace(/\\n+/g,' | ').slice(0,140)")

    b.close()

print(json.dumps(result, ensure_ascii=False, indent=1))
print("PAGE_ERRORS:", json.dumps(errs[:10], ensure_ascii=False))
