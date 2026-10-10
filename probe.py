import json
from patchright.sync_api import sync_playwright

URL = "http://127.0.0.1:8137/"
events = []

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page()
    pg.on("pageerror", lambda e: events.append("pageerror: " + str(e)[:200]))
    pg.on("console", lambda m: events.append("console-error: " + m.text[:200]) if m.type == "error" else None)
    pg.on("framenavigated", lambda f: events.append("nav: " + f.url[:80]))

    pg.goto(URL, wait_until="domcontentloaded")
    pg.wait_for_function("!!window.__gw", timeout=30000)
    print("A_after-boot:", pg.evaluate("JSON.stringify({gw: typeof window.__gw, words: typeof WORDS, unit: typeof UNIT, dict: typeof DICT, url: location.href})"))

    pg.evaluate("document.getElementById('startBtn').click()")
    pg.wait_for_timeout(500)
    print("B_after-startBtn:", pg.evaluate("JSON.stringify({gw: typeof window.__gw, setup: document.getElementById('setup').style.display})"))

    pg.evaluate("document.getElementById('beginBtn').click()")
    pg.wait_for_timeout(1200)
    print("C_after-begin:", pg.evaluate("JSON.stringify({gw: typeof window.__gw, url: location.href, game: document.getElementById('game').style.display, rows: document.querySelectorAll('#board .row').length, inputDisabled: (document.getElementById('guessInput')||{}).disabled})"))
    pg.wait_for_timeout(2000)
    print("D_2s-later:", pg.evaluate("JSON.stringify({gw: typeof window.__gw, url: location.href, game: document.getElementById('game').style.display})"))

    b.close()

print("EVENTS:", json.dumps(events[:15], ensure_ascii=False))
