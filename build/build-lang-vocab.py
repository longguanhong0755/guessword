# Build candidate vocabulary lists for the 5 new languages.
# ja: OpenJLPT N5-N1 (CC BY-SA 4.0) -> levels 0..4
# ko: Yonsei Korean vol 1-6 lexemes (CC BY-SA 3.0) -> levels 0..5
# fr/de/es: FrequencyWords (OpenSubtitles, CC BY-SA) top 50k -> 6 frequency bands
# Output: /d/gw-dl/lang/vocab-<lang>.json  [{w, lv, src, extra...}]
import json, os, re

LANG = "D:/gw-dl/lang"

# ---------------- Japanese: JLPT ----------------
ja = {}
for lv in ["n5", "n4", "n3", "n2", "n1"]:
    lvl = {"n5": 0, "n4": 1, "n3": 2, "n2": 3, "n1": 4}[lv]
    for e in json.load(open(f"{LANG}/jlpt-{lv}.json", encoding="utf-8")):
        w = e["word"].strip()
        if not w or " " in w or "・" in w or "　" in w:
            continue
        if w in ja and ja[w]["lv"] <= lvl:
            continue
        ja[w] = {"w": w, "lv": lvl, "src": "jlpt",
                 "reading": e.get("reading", ""), "romaji": e.get("romaji", ""),
                 "en": "; ".join(e.get("meanings", [])[:3]), "pos": ",".join(e.get("pos", [])[:3])}
# optional extension tier (level 9 = guess-only) from Japanese frequency list
freq_ja = []
for line in open(f"{LANG}/freq/ja_full.txt", encoding="utf-8"):
    p = line.split()
    if len(p) >= 2:
        freq_ja.append(p[0])
for w in freq_ja:
    if re.fullmatch(r"[\u3040-\u30ff\u4e00-\u9fff\u30fcー]+", w) and 1 < len(w) <= 8 and w not in ja:
        ja[w] = {"w": w, "lv": 9, "src": "freq-ja"}
json.dump(list(ja.values()), open(f"{LANG}/vocab-ja.json", "w"), ensure_ascii=False)
print(f"ja: {sum(1 for v in ja.values() if v['lv']<9)} JLPT + {sum(1 for v in ja.values() if v['lv']==9)} freq = {len(ja)}")

# ---------------- Korean: Yonsei ----------------
ko_ = {}
for v in ["01", "02", "03", "04", "05", "06"]:
    d = json.load(open(f"{LANG}/yonsei-vol-{v}.json", encoding="utf-8"))
    lvl = int(v) - 1
    for r in d["rows"]:
        if r.get("entry_kind") != "lexeme":
            continue
        w = (r.get("korean") or "").strip()
        if not w or " " in w:
            continue
        if w in ko_ and ko_[w]["lv"] <= lvl:
            continue
        ko_[w] = {"w": w, "lv": lvl, "src": "yonsei",
                  "zh": r.get("chinese", ""), "en": r.get("english", ""),
                  "pos": r.get("pos_zh") or r.get("pos", "")}
freq_ko = []
for line in open(f"{LANG}/freq/ko_50k.txt", encoding="utf-8"):
    p = line.split()
    if len(p) >= 2:
        freq_ko.append(p[0])
for w in freq_ko:
    if re.fullmatch(r"[\uac00-\ud7a3]+", w) and 1 < len(w) <= 8 and w not in ko_:
        ko_[w] = {"w": w, "lv": 9, "src": "freq-ko"}
json.dump(list(ko_.values()), open(f"{LANG}/vocab-ko.json", "w"), ensure_ascii=False)
print(f"ko: {sum(1 for v in ko_.values() if v['lv']<9)} yonsei + {sum(1 for v in ko_.values() if v['lv']==9)} freq = {len(ko_)}")

# ---------------- fr/de/es: frequency bands ----------------
BANDS = [500, 1000, 2000, 4000, 8000, 20000]
for lang in ["fr", "de", "es"]:
    seen, out = set(), []
    n = 0
    for line in open(f"{LANG}/freq/{lang}_50k.txt", encoding="utf-8"):
        p = line.split()
        if len(p) < 2:
            continue
        w = p[0]
        if not re.fullmatch(r"[a-zà-öø-ÿœæß'-]+", w, re.I) or len(w) < 2 or w in seen:
            continue
        seen.add(w)
        n += 1
        lv = next((i for i, b in enumerate(BANDS) if n <= b), 9)
        out.append({"w": w, "lv": lv, "src": "freq", "rank": n})
    json.dump(out, open(f"{LANG}/vocab-{lang}.json", "w"), ensure_ascii=False)
    print(f"{lang}: {sum(1 for x in out if x['lv']<9)} banded + {sum(1 for x in out if x['lv']==9)} extra = {len(out)}")
