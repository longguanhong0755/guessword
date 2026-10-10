import json, sys
from patchright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8137/guessword.html"

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--no-proxy-server"])
    pg = b.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(URL, wait_until="domcontentloaded")
    pg.wait_for_function("document.getElementById('dictCount') && document.getElementById('dictCount').textContent !== '…'", timeout=60000)

    # start a game (A2 single level)
    pg.evaluate("document.getElementById('startBtn').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("document.querySelectorAll('.lvCard')[1].click()")
    pg.wait_for_timeout(200)
    pg.evaluate("document.querySelectorAll('.lvCard')[1].click()")
    pg.wait_for_timeout(200)
    pg.evaluate("document.getElementById('beginBtn').click()")
    pg.wait_for_timeout(800)

    def guess(w):
        pg.fill("#guessInput", w)
        pg.press("#guessInput", "Enter")
        pg.wait_for_timeout(900)

    # 1) lemma mapping: 'cats' should add a row showing 'Cat'
    guess("cats")
    rows = pg.evaluate("[...document.querySelectorAll('#board .row')].map(r=>r.textContent.replace(/\\s+/g,' ').slice(0,60))")
    print("after 'cats':", json.dumps(rows, ensure_ascii=False))

    # 2) duplicate via lemma: guessing 'cat' after 'cats' should error as duplicate
    guess("cat")
    res = pg.evaluate("(document.getElementById('resultArea')||{}).textContent || ''")
    print("after 'cat' dup:", res[:80])

    # 3) irregular: 'went' -> 'go' row
    guess("went")
    rows2 = pg.evaluate("[...document.querySelectorAll('#board .row')].map(r=>r.textContent.replace(/\\s+/g,' ').slice(0,60))")
    print("after 'went':", json.dumps(rows2, ensure_ascii=False))

    # 4) UK spelling: 'colour' -> 'color' row
    guess("colour")
    rows3 = pg.evaluate("[...document.querySelectorAll('#board .row')].map(r=>r.textContent.replace(/\\s+/g,' ').slice(0,60))")
    print("after 'colour':", json.dumps(rows3, ensure_ascii=False))

    # 5) removed proper noun: 'london' should be rejected
    guess("london")
    res2 = pg.evaluate("(document.getElementById('resultArea')||{}).textContent || ''")
    print("after 'london':", res2[:80])

    # 6) kept word: 'people' should be accepted
    guess("people")
    rows4 = pg.evaluate("[...document.querySelectorAll('#board .row')].map(r=>r.textContent.replace(/\\s+/g,' ').slice(0,60))")
    print("after 'people':", json.dumps(rows4, ensure_ascii=False))

    print("PAGE_ERRORS:", errs)
    b.close()
