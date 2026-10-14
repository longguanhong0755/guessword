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
    result["remote_mode"] = pg.evaluate("document.documentElement.getAttribute('data-gw-remote')") == "1"
    result["vec_downloads_at_boot"] = [r for r in REQS if "-vec-" in r]

    # ---------- play an English game ----------
    pg.evaluate("document.getElementById('startBtn').click()")
    pg.wait_for_timeout(250)
    pg.evaluate("document.querySelectorAll('.lvCard')[0].click()")
    pg.wait_for_timeout(120)
    pg.evaluate("document.querySelectorAll('.lvCard')[1].click()")
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
    pg.wait_for_timeout(1500)
    result["api_guess_called"] = any("/api/guess" in r for r in reqs_since(m))
    result["boardRow1"] = pg.evaluate("(document.querySelector('#board .row:last-child')||{innerText:''}).innerText.replace(/\\n+/g,' | ').slice(0,130)")

    # hint (menu -> 提示)
    m = len(REQS)
    pg.evaluate("document.getElementById('menuBtn').click()")
    pg.wait_for_timeout(250)
    pg.evaluate("document.getElementById('hintItem').click()")
    pg.wait_for_timeout(1600)
    result["api_hint_called"] = any("/api/hint" in r for r in reqs_since(m))
    result["boardRows_after_hint"] = pg.evaluate("document.querySelectorAll('#board .row').length")
    result["hint_row"] = pg.evaluate("(() => { const r=document.querySelector('#board .hintIc'); return r ? r.closest('.row').innerText.replace(/\\n+/g,' | ').slice(0,100) : null; })()")

    # dictionary of the first guessed word (click the board word)
    m = len(REQS)
    pg.evaluate("document.querySelector('#board .rowWord').click()")
    pg.wait_for_timeout(1500)
    result["api_def_called"] = any("/api/def" in r for r in reqs_since(m))
    result["dict_en"] = pg.evaluate("document.getElementById('dlEntry').innerText.replace(/\\n+/g,' | ').slice(0,220)")
    result["dict_en_has_content"] = pg.evaluate("document.querySelectorAll('#dlEntry .dlDef').length > 0")
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
    pg.wait_for_timeout(1500)
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
    pg.wait_for_timeout(2200)
    result["win_result_word"] = pg.evaluate("(document.getElementById('resWord')||{textContent:''}).textContent")
    pg.evaluate("document.getElementById('histHomeBtn').click()")
    pg.wait_for_timeout(400)
    result["hist_after_win"] = pg.evaluate("""(() => ({
      unfinished: document.querySelectorAll('.histOng').length,
      finished: document.querySelectorAll('.histItem:not(.histOng)').length,
      sub: document.getElementById('histSub').innerText
    }))()""")
    pg.evaluate("document.getElementById('histClose').click()")
    pg.wait_for_timeout(250)

    # ---------- language switch: no vector chunks, only meta ----------
    m = len(REQS)
    t1 = time.time()
    pg.evaluate("document.querySelector('.langBtn[data-lang=\"ja\"]').click()")
    pg.wait_for_function("() => { const b=document.querySelector('.langBtn[data-lang=\"ja\"]'); return b && b.classList.contains('on'); }", timeout=30000)
    result["lang_switch_sec"] = round(time.time() - t1, 2)
    switched = reqs_since(m)
    result["lang_switch_vec_downloads"] = [r for r in switched if "-vec-" in r]
    result["lang_switch_meta"] = [r for r in switched if "meta.json" in r]
    result["lang_switch_dict_chunks"] = [r for r in switched if "gwdict" in r]

    # play a Japanese game and verify the server engine handles it
    pg.evaluate("document.getElementById('startBtn').click()")
    pg.wait_for_timeout(250)
    pg.evaluate("document.querySelectorAll('.lvCard')[0].click()")
    pg.wait_for_timeout(120)
    pg.evaluate("document.querySelectorAll('.lvCard')[0].click()")
    pg.wait_for_timeout(120)
    pg.evaluate("document.getElementById('beginBtn').click()")
    pg.wait_for_timeout(1200)
    result["placeholder_ja"] = pg.evaluate("document.getElementById('guessInput').placeholder")
    pg.fill("#guessInput", "あ")
    pg.wait_for_timeout(400)
    pg.evaluate("document.querySelector('#acBox .acItem').click()")
    pg.wait_for_timeout(250)
    pg.press("#guessInput", "Enter")
    pg.wait_for_timeout(1600)
    result["boardRow_ja"] = pg.evaluate("(document.querySelector('#board .row:last-child')||{innerText:''}).innerText.replace(/\\n+/g,' | ').slice(0,120)")
    # japanese dictionary through the API
    pg.evaluate("document.querySelector('#board .rowWord').click()")
    pg.wait_for_timeout(1500)
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
    pg.evaluate("document.querySelectorAll('.lvCard')[0].click()")
    pg.wait_for_timeout(120)
    pg.evaluate("document.querySelectorAll('.lvCard')[1].click()")
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

    # ---------- fallback: /api unreachable -> local vector engine ----------
    ctx2 = b.new_context()
    pg2 = ctx2.new_page()
    reqs2 = []
    errs2 = []
    pg2.on("pageerror", lambda e: errs2.append("pageerror: " + str(e)))
    pg2.on("request", lambda r: reqs2.append(brief(r.url)))
    pg2.route("**/api/**", lambda route: route.abort())
    pg2.goto(URL, wait_until="domcontentloaded")
    pg2.wait_for_function("document.getElementById('dictCount') && document.getElementById('dictCount').textContent !== '…'", timeout=60000)
    pg2.evaluate("document.getElementById('startBtn').click()")
    pg2.wait_for_timeout(250)
    pg2.evaluate("document.querySelectorAll('.lvCard')[0].click()")
    pg2.wait_for_timeout(120)
    pg2.evaluate("document.querySelectorAll('.lvCard')[0].click()")
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
