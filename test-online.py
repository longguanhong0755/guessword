"""End-to-end test for the ONLINE deploy variant (server-side ranking engine + dictionary + resume).
usage: python test-online.py [url]   (default http://127.0.0.1:8139 = wrangler pages dev site/)

Checks:
  1. boot without any vector-bank download (only the light meta)
  2. play: guess via autocomplete/API, hint, dictionary via /api/def
  3. finish a game -> history entry
  4. unfinished games: home "continue" + history list section + resume after reload
  5. language switch: no vector chunks, only gw-<L>-meta.json
  6. resume an unfinished game that belongs to another language
"""
import json, sys, time
from patchright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8139/"
result, errs = {}, []
REQS = []

INIT = """
setInterval(function(){
  try{
    var g = window.__gw; if(!g) return;
    var d = document.documentElement;
    var a = g.answer;
    if (a && d.getAttribute('data-gw-answer') !== a) d.setAttribute('data-gw-answer', a);
    var t = g.token;
    if (t && d.getAttribute('data-gw-token') !== t) d.setAttribute('data-gw-token', t);
    if (t === null && d.getAttribute('data-gw-token') !== null) d.removeAttribute('data-gw-token');
    var rm = g.remote() ? "1" : "0";
    if (d.getAttribute('data-gw-remote') !== rm) d.setAttribute('data-gw-remote', rm);
    if (!d.getAttribute('data-gw-daily') && g.daily){
      var n = new Date(), p = function(v){ return ("0" + v).slice(-2); };
      var dw = g.daily("en", n.getFullYear() + "-" + p(n.getMonth()+1) + "-" + p(n.getDate()));
      if (dw) d.setAttribute('data-gw-daily', dw);
    }
  }catch(e){}
}, 150);
"""


def brief(u):
    return u.split("?")[0].replace(URL.rstrip("/"), "")


with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page()
    pg.add_init_script(INIT)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append("console-error: " + m.text) if m.type == "error" else None)
    pg.on("request", lambda r: REQS.append(brief(r.url)))

    def reqs_since(mark):
        return REQS[mark:]

    t0 = time.time()
    pg.goto(URL, wait_until="domcontentloaded")
    pg.wait_for_function("document.getElementById('dictCount') && document.getElementById('dictCount').textContent !== '…'", timeout=60000)
    result["boot_sec"] = round(time.time() - t0, 2)
    pg.wait_for_function("document.documentElement.getAttribute('data-gw-remote') !== null", timeout=15000)
    result["remote_mode"] = pg.evaluate("document.documentElement.getAttribute('data-gw-remote')") == "1"
    result["vec_downloads_at_boot"] = [r for r in REQS if "-vec-" in r]
    pg.wait_for_timeout(400)
    result["boot_warm_ping"] = any("/api/warm" in r for r in REQS)   # page load pre-warms the isolate

    # ---------- play an English game ----------
    pg.evaluate("document.getElementById('startBtn').click()")
    pg.wait_for_timeout(250)
    pg.evaluate("document.querySelectorAll('.lvLab')[0].click()")
    pg.wait_for_timeout(120)
    pg.evaluate("document.querySelectorAll('.lvLab')[1].click()")
    pg.wait_for_timeout(120)
    m = len(REQS)
    pg.evaluate("document.getElementById('beginBtn').click()")
    pg.wait_for_timeout(1200)
    result["api_new_called"] = any("/api/new" in r for r in reqs_since(m))
    result["placeholder_en"] = pg.evaluate("document.getElementById('guessInput').placeholder")

    # autocomplete click -> value + guess through /api/guess
    pg.fill("#guessInput", "abou")
    pg.wait_for_timeout(400)
    pg.evaluate("document.querySelector('#acBox .acItem').click()")
    pg.wait_for_timeout(250)
    result["acClickValue_en"] = pg.evaluate("document.getElementById('guessInput').value")
    m = len(REQS)
    pg.press("#guessInput", "Enter")
    pg.wait_for_function("document.querySelectorAll('#board .row').length >= 1", timeout=40000)
    pg.wait_for_timeout(300)
    result["api_guess_called"] = any("/api/guess" in r for r in reqs_since(m))
    result["boardRow1"] = pg.evaluate("(document.querySelector('#board .row:last-child')||{innerText:''}).innerText.replace(/\\n+/g,' | ').slice(0,130)")

    # hint (menu -> 提示)
    m = len(REQS)
    pg.evaluate("document.getElementById('menuBtn').click()")
    pg.wait_for_timeout(250)
    pg.evaluate("document.getElementById('hintItem').click()")
    pg.wait_for_function("document.querySelectorAll('#board .row').length >= 2", timeout=40000)
    pg.wait_for_timeout(300)
    result["api_hint_called"] = any("/api/hint" in r for r in reqs_since(m))
    result["boardRows_after_hint"] = pg.evaluate("document.querySelectorAll('#board .row').length")
    result["hint_row"] = pg.evaluate("(() => { const r=document.querySelector('#board .hintIc'); return r ? r.closest('.row').innerText.replace(/\\n+/g,' | ').slice(0,100) : null; })()")

    # dictionary of the first guessed word (click the board word)
    m = len(REQS)
    pg.evaluate("document.querySelector('#board .rowWord').click()")
    pg.wait_for_function("document.querySelectorAll('#dlEntry .dlDef').length > 0", timeout=40000)
    pg.wait_for_timeout(200)
    result["api_def_called"] = any("/api/def" in r for r in reqs_since(m))
    result["dict_en"] = pg.evaluate("document.getElementById('dlEntry').innerText.replace(/\\n+/g,' | ').slice(0,220)")
    result["dict_en_has_content"] = pg.evaluate("document.querySelectorAll('#dlEntry .dlDef').length > 0")
    # dictionary fallback: a word our dictionary does not hold gets an external lookup link
    pg.evaluate("document.getElementById('dlSearch').value='zzzzzz'; document.getElementById('dlGo').click()")
    pg.wait_for_function("!!document.querySelector('#dlEntry .dlExt')", timeout=20000)
    result["dict_fallback"] = pg.evaluate("""(() => {
        const a = document.querySelector('#dlEntry .dlExt');
        return {text: document.getElementById('dlEntry').innerText.replace(/\\n+/g,' | ').slice(0,100),
                href: a.href, target: a.target};
    })()""")
    pg.evaluate("document.getElementById('dlClose').click()")
    pg.wait_for_timeout(250)

    # ---------- leave the game unfinished -> home + history + reload + resume ----------
    pg.evaluate("document.getElementById('homeBtn').click()")
    pg.wait_for_timeout(300)
    if pg.evaluate("!!document.getElementById('confirmYes') && document.getElementById('confirmOverlay').classList.contains('open')"):
        pg.evaluate("document.getElementById('confirmYes').click()")
        pg.wait_for_timeout(400)
    result["resume_btn_text"] = pg.evaluate("document.getElementById('resumeBtn').innerText")
    result["resume_btn_shown"] = pg.evaluate("document.getElementById('resumeBtn').classList.contains('show')")
    pg.evaluate("document.getElementById('histHomeBtn').click()")
    pg.wait_for_timeout(400)
    result["hist_unfinished"] = pg.evaluate("""(() => {
      const items=[...document.querySelectorAll('.histOng')];
      return {count: items.length, first: items[0] ? items[0].innerText.replace(/\\n+/g,' | ').slice(0,120) : null,
              hasContinue: !!document.querySelector('.histCont')};
    })()""")
    # expand the unfinished row to check its rows render
    pg.evaluate("document.querySelector('.histOng .histRow').click()")
    pg.wait_for_timeout(300)
    result["hist_unfinished_rows"] = pg.evaluate("document.querySelectorAll('.histOng .hRow').length")
    pg.evaluate("document.getElementById('histClose').click()")
    pg.wait_for_timeout(300)

    # reload: the unfinished game must survive (token saved)
    pg.reload(wait_until="domcontentloaded")
    pg.wait_for_function("document.getElementById('dictCount') && document.getElementById('dictCount').textContent !== '…'", timeout=60000)
    pg.wait_for_timeout(500)
    result["resume_after_reload"] = pg.evaluate("document.getElementById('resumeBtn').innerText")
    pg.evaluate("document.getElementById('resumeBtn').click()")
    pg.wait_for_timeout(1500)
    result["resumed_board_rows"] = pg.evaluate("document.querySelectorAll('#board .row').length")
    result["resumed_state"] = pg.evaluate("document.getElementById('guessCounter').textContent")
    # and it must still be playable
    m = len(REQS)
    pg.fill("#guessInput", "whi")
    pg.wait_for_timeout(350)
    pg.press("#guessInput", "Tab")
    pg.wait_for_timeout(200)
    pg.press("#guessInput", "Enter")
    pg.wait_for_function("document.querySelectorAll('#board .row').length >= 3", timeout=40000)
    result["api_guess_after_resume"] = any("/api/guess" in r for r in reqs_since(m))
    result["board_rows_after_resume_guess"] = pg.evaluate("document.querySelectorAll('#board .row').length")

    # ---------- win it via the token (hint r=1 = secret) ----------
    tok = pg.evaluate("document.documentElement.getAttribute('data-gw-token')")
    secret = pg.evaluate(
        "async (t) => { const r = await fetch('/api/hint', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({t, r:1})}); return (await r.json()).word; }",
        tok)
    result["secret_via_api"] = secret
    pg.fill("#guessInput", secret)
    pg.press("#guessInput", "Enter")
    pg.wait_for_function("(document.getElementById('resWord')||{}).textContent", timeout=40000)
    pg.wait_for_timeout(300)
    result["win_result_word"] = pg.evaluate("(document.getElementById('resWord')||{textContent:''}).textContent")
    result["rank_chart"] = pg.evaluate("""(() => ({
        hasSvg: !!document.querySelector('#rankChart svg'),
        points: document.querySelectorAll('#rankChart .rcDot, #rankChart .rcHint, #rankChart .rcWin').length,
        boardRows: document.querySelectorAll('#board .row').length,
        hints: document.querySelectorAll('#rankChart .rcHint').length,
        firstTip: (document.querySelector('#rankChart title')||{textContent:''}).textContent,
        cap: document.getElementById('chartCap').textContent
    }))()""")
    # share card: the canvas-rendered PNG preview
    pg.evaluate("document.getElementById('shareCardBtn').click()")
    pg.wait_for_function("document.getElementById('shareOverlay').classList.contains('open')", timeout=15000)
    pg.wait_for_function("(() => { const i = document.getElementById('shareImg'); return i && i.naturalWidth > 400; })()", timeout=20000)
    result["share_card"] = pg.evaluate("""(() => {
        const i = document.getElementById('shareImg');
        return {w: i.naturalWidth, h: i.naturalHeight, src: i.src.slice(0, 22),
                dl: document.getElementById('shareDl').getAttribute('download')};
    })()""")
    pg.evaluate("document.getElementById('shareClose').click()")
    pg.wait_for_timeout(200)
    # dictionary failure fallback: /api/def down -> retry button, then it recovers
    errs_mark = len(errs)
    pg.route("**/api/def*", lambda route: route.abort())
    pg.evaluate("document.getElementById('resWord').click()")
    pg.wait_for_function("!!document.querySelector('#dlEntry .dlRetry')", timeout=30000)
    result["dict_retry_shown"] = pg.evaluate("document.getElementById('dlEntry').innerText.replace(/\\n+/g,' | ').slice(0,100)")
    pg.unroute("**/api/def*")
    pg.evaluate("document.querySelector('#dlEntry .dlRetry').click()")
    pg.wait_for_function("""(() => {
        const t = document.getElementById('dlEntry').innerText;
        return !document.querySelector('#dlEntry .dlRetry') && t.indexOf('加载失败') < 0 && t.indexOf('加载中') < 0;
    })()""", timeout=30000)
    result["dict_retry_ok"] = pg.evaluate("document.getElementById('dlEntry').innerText.replace(/\\n+/g,' | ').slice(0,100)")
    del errs[errs_mark:]   # the deliberate /api/def abort noise
    pg.evaluate("document.getElementById('dlClose').click()")
    pg.wait_for_timeout(250)
    pg.evaluate("document.getElementById('histHomeBtn').click()")
    pg.wait_for_timeout(400)
    result["hist_after_win"] = pg.evaluate("""(() => ({
      unfinished: document.querySelectorAll('.histOng').length,
      finished: document.querySelectorAll('.histItem:not(.histOng)').length,
      sub: document.getElementById('histSub').innerText
    }))()""")
    result["hist_stats"] = pg.evaluate("document.getElementById('histStats').innerText.replace(/\\n+/g,' | ').slice(0,140)")
    pg.evaluate("document.getElementById('histClose').click()")
    pg.wait_for_timeout(250)

    # ---------- daily challenge: one word per language per day, first run = official score ----------
    today = time.strftime("%Y-%m-%d")

    def api_hint1(tok):
        return pg.evaluate("async (t) => { const r = await fetch('/api/hint', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({t, r:1})}); return (await r.json()).word; }", tok)

    tok_prev = pg.evaluate("document.documentElement.getAttribute('data-gw-token')")
    pg.evaluate("document.getElementById('dailyBtn').click()")
    pg.wait_for_function("/每日挑战/.test(document.getElementById('modeBadge').textContent)", timeout=40000)
    pg.wait_for_function("(t) => { const v = document.documentElement.getAttribute('data-gw-token'); return !!v && v !== t; }", arg=tok_prev, timeout=40000)
    tok_d1 = pg.evaluate("document.documentElement.getAttribute('data-gw-token')")
    d_secret1 = api_hint1(tok_d1)
    pg.wait_for_function("document.documentElement.getAttribute('data-gw-daily') !== null", timeout=15000)
    d_client = pg.evaluate("document.documentElement.getAttribute('data-gw-daily')")
    d_fresh = pg.evaluate("""async (d) => {
        const r1 = await fetch('/api/new', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({lang:'en', lo:0, hi:5, daily:d})});
        const t1 = (await r1.json()).t;
        const h = await fetch('/api/hint', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({t:t1, r:1})});
        return (await h.json()).word;
    }""", today)
    result["daily"] = {"badge": pg.evaluate("document.getElementById('modeBadge').textContent"),
                       "secret": d_secret1, "client": d_client, "fresh": d_fresh,
                       "stable": d_secret1 == d_client == d_fresh}
    # finish run 1 by winning -> becomes the official score of the day
    pg.fill("#guessInput", d_secret1)
    pg.press("#guessInput", "Enter")
    pg.wait_for_function("document.querySelectorAll('#board .row').length >= 1", timeout=40000)
    pg.evaluate("document.getElementById('resWord').textContent = ''")
    pg.wait_for_function("(document.getElementById('resWord')||{}).textContent.length > 0", timeout=40000)
    pg.evaluate("document.getElementById('homeBtn').click()")
    pg.wait_for_timeout(500)
    result["daily_btn_done"] = pg.evaluate("document.getElementById('dailyBtn').innerText")
    # run 2 = practice: same word again (fresh token), then give up
    pg.evaluate("document.getElementById('dailyBtn').click()")
    pg.wait_for_function("(t) => { const v = document.documentElement.getAttribute('data-gw-token'); return !!v && v !== t; }", arg=tok_d1, timeout=40000)
    tok_d2 = pg.evaluate("document.documentElement.getAttribute('data-gw-token')")
    result["daily_again"] = {"same_word": api_hint1(tok_d2) == d_secret1, "new_token": tok_d2 != tok_d1}
    pg.evaluate("document.getElementById('menuBtn').click()")
    pg.wait_for_timeout(250)
    pg.evaluate("document.getElementById('giveupItem').click()")
    pg.wait_for_timeout(250)
    pg.evaluate("document.getElementById('confirmYes').click()")
    pg.wait_for_function("document.getElementById('resultsView').style.display === 'block'", timeout=30000)
    pg.evaluate("document.getElementById('homeBtn').click()")
    pg.wait_for_timeout(400)
    result["daily_btn_after_practice"] = pg.evaluate("document.getElementById('dailyBtn').innerText")

    # ---------- language switch: no vector chunks, only meta ----------
    m = len(REQS)
    t1 = time.time()
    pg.evaluate("document.querySelector('.langBtn[data-lang=\"ja\"]').click()")
    pg.wait_for_function("() => { const b=document.querySelector('.langBtn[data-lang=\"ja\"]'); return b && b.classList.contains('on'); }", timeout=30000)
    pg.wait_for_timeout(400)   # the switch-side warm fires right after the UI flips
    result["lang_switch_sec"] = round(time.time() - t1, 2)
    switched = reqs_since(m)
    result["lang_switch_vec_downloads"] = [r for r in switched if "-vec-" in r]
    result["lang_switch_meta"] = [r for r in switched if "meta.json" in r]
    result["lang_switch_dict_chunks"] = [r for r in switched if "gwdict" in r]
    result["lang_switch_warm"] = any("/api/warm" in r for r in switched)   # switching pre-warms that language

    # play a Japanese game and verify the server engine handles it
    pg.evaluate("document.getElementById('startBtn').click()")
    pg.wait_for_timeout(250)
    pg.evaluate("document.querySelectorAll('.lvLab')[0].click()")
    pg.wait_for_timeout(120)
    pg.evaluate("document.querySelectorAll('.lvLab')[0].click()")
    pg.wait_for_timeout(120)
    pg.evaluate("document.getElementById('beginBtn').click()")
    pg.wait_for_timeout(1200)
    result["placeholder_ja"] = pg.evaluate("document.getElementById('guessInput').placeholder")
    pg.fill("#guessInput", "あ")
    pg.wait_for_timeout(400)
    pg.evaluate("document.querySelector('#acBox .acItem').click()")
    pg.wait_for_timeout(250)
    pg.press("#guessInput", "Enter")
    pg.wait_for_function("document.querySelectorAll('#board .row').length >= 1", timeout=40000)
    result["boardRow_ja"] = pg.evaluate("(document.querySelector('#board .row:last-child')||{innerText:''}).innerText.replace(/\\n+/g,' | ').slice(0,120)")
    # japanese dictionary through the API
    pg.evaluate("document.querySelector('#board .rowWord').click()")
    pg.wait_for_function("document.querySelectorAll('#dlEntry .dlDef').length > 0", timeout=40000)
    result["dict_ja_zh"] = pg.evaluate("""(() => {
        const defs=[...document.querySelectorAll('#dlEntry .dlDef')].map(e=>e.innerText);
        const cjk=defs.filter(t=>/[\\u4e00-\\u9fff]/.test(t));
        return {defs: defs.length, withZh: cjk.length, first: (cjk[0]||'').slice(0,50)};
    })()""")
    pg.evaluate("document.getElementById('dlClose').click()")
    pg.wait_for_timeout(200)

    # ---------- two unfinished games in two languages, resume across languages ----------
    pg.evaluate("document.getElementById('homeBtn').click()")
    pg.wait_for_timeout(300)
    if pg.evaluate("document.getElementById('confirmOverlay').classList.contains('open')"):
        pg.evaluate("document.getElementById('confirmYes').click()")
        pg.wait_for_timeout(400)
    pg.evaluate("document.getElementById('histHomeBtn').click()")
    pg.wait_for_timeout(400)
    result["hist_unfinished_after_ja"] = pg.evaluate("document.querySelectorAll('.histOng').length")
    pg.evaluate("document.getElementById('histClose').click()")
    pg.wait_for_timeout(250)

    # start an English game too, guess once, leave it unfinished
    pg.evaluate("document.querySelector('.langBtn[data-lang=\"en\"]').click()")
    pg.wait_for_timeout(600)
    pg.evaluate("document.getElementById('startBtn').click()")
    pg.wait_for_timeout(250)
    pg.evaluate("document.querySelectorAll('.lvLab')[0].click()")
    pg.wait_for_timeout(120)
    pg.evaluate("document.querySelectorAll('.lvLab')[1].click()")
    pg.wait_for_timeout(120)
    pg.evaluate("document.getElementById('beginBtn').click()")
    pg.wait_for_timeout(1200)
    pg.fill("#guessInput", "whi")
    pg.wait_for_timeout(350)
    pg.press("#guessInput", "Tab")
    pg.wait_for_timeout(200)
    pg.press("#guessInput", "Enter")
    pg.wait_for_timeout(1500)
    pg.evaluate("document.getElementById('homeBtn').click()")
    pg.wait_for_timeout(300)
    if pg.evaluate("document.getElementById('confirmOverlay').classList.contains('open')"):
        pg.evaluate("document.getElementById('confirmYes').click()")
        pg.wait_for_timeout(400)
    pg.evaluate("document.getElementById('histHomeBtn').click()")
    pg.wait_for_timeout(400)
    result["hist_two_unfinished"] = pg.evaluate("document.querySelectorAll('.histOng').length")

    # resume the newest unfinished (english) while the current language is ja
    pg.evaluate("document.querySelectorAll('.histOng')[0].querySelector('.histCont').click()")
    pg.wait_for_timeout(2500)
    result["resume_en_placeholder"] = pg.evaluate("document.getElementById('guessInput').placeholder")
    result["resume_en_rows"] = pg.evaluate("document.querySelectorAll('#board .row').length")
    result["resume_en_badge"] = pg.evaluate("document.getElementById('modeBadge').textContent")
    result["resume_en_lang"] = pg.evaluate("document.querySelector('.langBtn.on').dataset.lang")

    # now resume the japanese one from the history list (language must switch back)
    pg.evaluate("document.getElementById('histHomeBtn').click()")
    pg.wait_for_timeout(400)
    pg.evaluate("(() => { const its=[...document.querySelectorAll('.histOng')]; its[its.length-1].querySelector('.histCont').click(); })()")
    pg.wait_for_timeout(2500)
    result["resume_ja_placeholder"] = pg.evaluate("document.getElementById('guessInput').placeholder")
    result["resume_ja_rows"] = pg.evaluate("document.querySelectorAll('#board .row').length")
    result["resume_ja_badge"] = pg.evaluate("document.getElementById('modeBadge').textContent")
    result["resume_ja_lang"] = pg.evaluate("document.querySelector('.langBtn.on').dataset.lang")

    # ---------- start-game responsiveness: slow /api/new must not lock the UI ----------
    ctx3 = b.new_context(viewport={"width": 430, "height": 880})
    pg3 = ctx3.new_page()
    errs3 = []
    pg3.on("pageerror", lambda e: errs3.append("pageerror: " + str(e)))
    slow_new = {"on": False}

    def _slow_new(route):
        if slow_new["on"]:
            time.sleep(2.5)
        route.continue_()

    pg3.route("**/api/new", _slow_new)
    pg3.goto(URL, wait_until="domcontentloaded")
    pg3.wait_for_function("document.getElementById('dictCount') && document.getElementById('dictCount').textContent !== '…'", timeout=60000)
    pg3.wait_for_timeout(600)
    slow_new["on"] = True
    pg3.evaluate("document.getElementById('startBtn').click()")
    pg3.wait_for_timeout(300)
    pg3.evaluate("document.querySelectorAll('.lvLab')[0].click()")
    pg3.wait_for_timeout(120)
    pg3.evaluate("document.querySelectorAll('.lvLab')[0].click()")
    pg3.wait_for_timeout(120)
    result["slow_new_click"] = pg3.evaluate("""() => {
        const t0 = performance.now();
        document.getElementById('beginBtn').click();
        return { ms: Math.round(performance.now() - t0),
                 screen: document.querySelector('.screen.on').id,
                 inputEnabled: !document.getElementById('guessInput').disabled,
                 preparing: !!document.querySelector('#resultArea .msgRow.loading') };
    }""")
    # type and submit before the secret has arrived: the guess must wait for it and succeed
    pg3.fill("#guessInput", "whi")
    pg3.wait_for_timeout(250)
    pg3.press("#guessInput", "Tab")
    pg3.wait_for_timeout(150)
    pg3.press("#guessInput", "Enter")
    pg3.wait_for_function("document.querySelectorAll('#board .row').length > 0", timeout=40000)
    result["slow_new_guess_row"] = pg3.evaluate("(document.querySelector('#board .row:last-child')||{innerText:''}).innerText")
    result["slow_new_errors"] = errs3[:5]
    ctx3.close()

    # ---------- fallback: /api unreachable -> local vector engine ----------
    ctx2 = b.new_context()
    pg2 = ctx2.new_page()
    pg2.add_init_script(INIT)   # record the page-reported remote flag for the fallback check
    reqs2 = []
    errs2 = []
    pg2.on("pageerror", lambda e: errs2.append("pageerror: " + str(e)))
    pg2.on("request", lambda r: reqs2.append(brief(r.url)))
    pg2.route("**/api/**", lambda route: route.abort())
    pg2.goto(URL, wait_until="domcontentloaded")
    pg2.wait_for_function("document.getElementById('dictCount') && document.getElementById('dictCount').textContent !== '…'", timeout=60000)
    pg2.evaluate("document.getElementById('startBtn').click()")
    pg2.wait_for_timeout(250)
    pg2.evaluate("document.querySelectorAll('.lvLab')[0].click()")
    pg2.wait_for_timeout(120)
    pg2.evaluate("document.querySelectorAll('.lvLab')[0].click()")
    pg2.wait_for_timeout(120)
    pg2.evaluate("document.getElementById('beginBtn').click()")
    pg2.wait_for_timeout(25000)
    result["fallback_local_mode"] = pg2.evaluate("document.documentElement.getAttribute('data-gw-remote')")
    result["fallback_vec_downloads"] = len([r for r in reqs2 if "-vec-" in r])
    result["fallback_placeholder"] = pg2.evaluate("document.getElementById('guessInput').placeholder")
    pg2.fill("#guessInput", "whi")
    pg2.wait_for_timeout(400)
    pg2.press("#guessInput", "Tab")
    pg2.wait_for_timeout(200)
    pg2.press("#guessInput", "Enter")
    pg2.wait_for_timeout(1500)
    result["fallback_board_row"] = pg2.evaluate("(document.querySelector('#board .row:last-child')||{innerText:''}).innerText.replace(/\\n+/g,' | ').slice(0,90)")
    result["fallback_errors"] = errs2[:5]
    ctx2.close()

    b.close()

print(json.dumps(result, ensure_ascii=False, indent=1))
print("PAGE_ERRORS:", json.dumps(errs[:12], ensure_ascii=False))
