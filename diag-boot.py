import json, time, sys
from patchright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "https://guessword.loongsite.com/"
events = []

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--no-proxy-server"])
    pg = b.new_page()
    pg.on("pageerror", lambda e: events.append("pageerror: " + str(e)[:300]))
    pg.on("console", lambda m: events.append("console-" + m.type + ": " + m.text[:300]))
    pg.on("requestfailed", lambda r: events.append("reqfail: " + r.url[-70:] + " :: " + str(r.failure)[:80]))
    pg.on("response", lambda r: events.append("resp " + str(r.status) + ": " + r.url[-70:]) if "/data/" in r.url else None)

    t0 = time.time()
    pg.goto(URL, wait_until="domcontentloaded")
    # poll boot state for up to 120s
    for i in range(24):
        pg.wait_for_timeout(5000)
        st = pg.evaluate("""() => {
            const dc = document.getElementById('dictCount');
            const bo = document.getElementById('bootOv');
            const bp = document.getElementById('bootBar') || document.querySelector('#bootOv .bar, #bootOv [class*=bar]');
            return {
                dictCount: dc ? dc.textContent : null,
                bootOv: bo ? (bo.style.display || 'unset') : null,
                bootOvText: bo ? bo.innerText.replace(/\\n+/g,' | ').slice(0,160) : null,
                barW: bp ? (bp.style.width || getComputedStyle(bp).width) : null,
                // main-world globals are invisible from patchright's isolated world,
                // so readiness is judged from the DOM (dictCount filled + boot overlay hidden)
                ready: !!(dc && dc.textContent && dc.textContent !== '\u2026' && (!bo || bo.style.display === 'none'))
            };
        }""")
        print(f"t+{round(time.time()-t0,1)}s: " + json.dumps(st, ensure_ascii=False), flush=True)
        if st.get("ready"):
            break
    print("EVENTS(last 25):")
    for e in events[-25:]:
        print("  " + e)
    b.close()
