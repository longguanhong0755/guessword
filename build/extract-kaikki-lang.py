# Extract per-language dictionary entries from kaikki.org jsonl for the game's vocabulary.
# usage: python extract-kaikki-lang.py <lang> <kaikki.jsonl>
# Output: /d/gw-dl/lang/dict-<lang>.json  { word: {rd?: reading, p: [ {p: pos, s: [{d, ex[]}] } ] } }
import json, re, sys, os

LANG = "D:/gw-dl/lang"
MAX_SENSES, MAX_EX, GLOSS_MAX = 5, 1, 220

lang = sys.argv[1]
src = sys.argv[2]
vocab = json.load(open(f"{LANG}/vocab-{lang}.json", encoding="utf-8"))
# restrict to words that survived into the game pack (have vectors), if a pack exists
pack_path = f"{LANG}/pack-{lang}.json"
in_game = None
if os.path.exists(pack_path):
    pack = json.load(open(pack_path, encoding="utf-8"))
    in_game = set(pack["words"].split("|"))
want = {}
for c in vocab:
    if in_game is not None and c["w"] not in in_game:
        continue
    want.setdefault(c["w"].lower(), c["w"])

out = {}
WRD = re.compile(r'"word":\s*"((?:[^"\\]|\\.)*)"')
n = 0
with open(src, encoding="utf-8", errors="replace") as f:
    for line in f:
        n += 1
        if '"word"' not in line:
            continue
        try:
            e = json.loads(line)
        except Exception:
            continue
        w = e.get("word")
        if not w:
            continue
        key = want.get(w.lower())
        if key is None:
            continue
        pos = e.get("pos", "")
        if pos in ("name", "phrase", "proverb"):
            continue
        senses = []
        for s in (e.get("senses") or []):
            g = (s.get("glosses") or [""])[0].strip()
            if not g or re.match(r"^(alternative|obsolete|archaic|misspelling|plural|inflection|form of|synonym of)", g, re.I):
                continue
            exs = []
            for x in (s.get("examples") or [])[:MAX_EX]:
                t = (x.get("text") or "").strip()
                if 0 < len(t) <= 180:
                    exs.append(t)
            senses.append({"d": g[:GLOSS_MAX], "ex": exs} if exs else {"d": g[:GLOSS_MAX]})
            if len(senses) >= MAX_SENSES:
                break
        if not senses:
            continue
        rec = out.setdefault(key, {"p": []})
        # reading for ja: kana forms from "forms" with tags containing 'kana'; keep first
        if lang == "ja" and "rd" not in rec:
            for fm in (e.get("forms") or []):
                tg = fm.get("tags") or []
                if fm.get("form") and ("kana" in tg or "hiragana" in tg or "katakana" in tg):
                    rec["rd"] = fm["form"]
                    break
        # merge senses into same-pos group, dedupe glosses
        grp = next((g for g in rec["p"] if g["p"] == pos), None)
        if grp is None:
            grp = {"p": pos, "s": []}
            rec["p"].append(grp)
        seen = {z["d"] for z in grp["s"]}
        for z in senses:
            if z["d"] not in seen and len(grp["s"]) < MAX_SENSES:
                grp["s"].append(z)
                seen.add(z["d"])

json.dump(out, open(f"{LANG}/dict-{lang}.json", "w"), ensure_ascii=False)
covered = len(out)
print(f"{lang}: dict entries {covered}/{len(vocab)} vocab words | lines scanned {n} | raw json size {os.path.getsize(f'{LANG}/dict-{lang}.json')//1024} KB")
