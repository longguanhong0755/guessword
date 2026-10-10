# Extract kaikki entries (pos/form_of/alt_of/sense glosses+tags) for GuessWord vocab words
# + ECDICT exchange (inflection) map from stardict.db.
# Output: build/kaikki-sub.json, build/ecdict-exchange.json, build/words-current.json
import json, re, sqlite3, os

ROOT = os.path.dirname(os.path.abspath(__file__))
KAIKKI = "D:/gw-dl/kaikki-english.jsonl"
STARDICT = "D:/gw-dl/ecdict-extract/stardict.db"
HTML = os.path.join(ROOT, "..", "guessword.html")

# current vocab straight from the master html
line = next(l.rstrip("\r\n") for l in open(HTML, encoding="utf-8") if l.startswith("const GWD="))
G = json.loads(line[len("const GWD="):-1])
words = G["words"].split("|")
json.dump(words, open(os.path.join(ROOT, "words-current.json"), "w"))
vocab = set(words)
print(f"vocab: {len(vocab)}")

WORD_RE = re.compile(r'"word": "((?:[^"\\]|\\.)*)"')
sub = {}   # lowercase word -> list of compact entries
n = 0
with open(KAIKKI, encoding="utf-8", errors="replace") as f:
    for line in f:
        n += 1
        if '"word": "' not in line:
            continue
        try:
            e = json.loads(line)   # top-level word only; nested "word" keys (translations etc.) must not be used
        except Exception:
            continue
        w = e.get("word")
        if not w:
            continue
        lw = w.lower()
        if lw not in vocab:
            continue
        senses = []
        for s in (e.get("senses") or [])[:4]:
            senses.append({
                "g": (s.get("glosses") or [""])[0][:120],
                "tags": (s.get("tags") or [])[:6],
                "form_of": [x.get("word") for x in (s.get("form_of") or [])][:3],
                "alt_of": [x.get("word") for x in (s.get("alt_of") or [])][:3],
            })
        sub.setdefault(lw, []).append({
            "word": e.get("word"), "pos": e.get("pos"),
            "forms": [{"form": x.get("form"), "tags": x.get("tags")} for x in (e.get("forms") or [])[:12]],
            "senses": senses,
        })

json.dump(sub, open(os.path.join(ROOT, "kaikki-sub.json"), "w"), ensure_ascii=False)
print(f"kaikki lines scanned: {n}, vocab words with entries: {len(sub)}")
posc = {}
for lw, es in sub.items():
    for e in es:
        posc[e["pos"]] = posc.get(e["pos"], 0) + 1
print("pos distribution:", json.dumps(dict(sorted(posc.items(), key=lambda x: -x[1])[:12])))
for probe in ("london", "mercedes", "smith", "went", "colour", "quickly", "hardly", "mice"):
    if probe in sub:
        e = sub[probe][0]
        print(f"  probe {probe}: word={e['word']} pos={e['pos']} gloss={e['senses'][0]['g'][:60] if e['senses'] else ''} form_of={e['senses'][0]['form_of'] if e['senses'] else []} alt_of={e['senses'][0]['alt_of'] if e['senses'] else []}")

# ECDICT exchange map
con = sqlite3.connect(STARDICT)
ex = {}
for (w, x) in con.execute("select word, exchange from stardict"):
    lw = w.lower()
    if lw in vocab and x:
        ex[lw] = x
con.close()
json.dump(ex, open(os.path.join(ROOT, "ecdict-exchange.json"), "w"), ensure_ascii=False)
print(f"ecdict exchange entries for vocab: {len(ex)}")
