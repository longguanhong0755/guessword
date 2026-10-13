# Augment dict-<lang>.json with vocabulary metadata (JLPT readings/meanings, Yonsei zh/en)
# so every game word has at least a minimal dictionary entry.
import json, os
LANG = "D:/gw-dl/lang"
for lang, src_key in (("ja", "jlpt"), ("ko", "yonsei")):
    dpath = f"{LANG}/dict-{lang}.json"
    d = json.load(open(dpath, encoding="utf-8")) if os.path.exists(dpath) else {}
    vocab = json.load(open(f"{LANG}/vocab-{lang}.json", encoding="utf-8"))
    pack = json.load(open(f"{LANG}/pack-{lang}.json", encoding="utf-8"))
    ingame = set(pack["words"].split("|"))
    added = enriched = 0
    for c in vocab:
        w = c["w"]
        if w not in ingame or c["src"] != src_key:
            continue
        e = d.get(w)
        if e is None:
            senses = []
            if c.get("en"):
                senses.append({"d": c["en"]})
            if c.get("zh"):
                senses.append({"d": "中文: " + c["zh"]})
            if senses:
                e = {"p": [{"p": c.get("pos") or "—", "s": senses}]}
                if c.get("reading"):
                    e["rd"] = c["reading"]
                d[w] = e
                added += 1
        else:
            if c.get("reading") and not e.get("rd"):
                e["rd"] = c["reading"]
            if c.get("zh"):
                if not any(s.get("d", "").startswith("中文:") for g in e["p"] for s in g["s"]):
                    e["p"].append({"p": "中文", "s": [{"d": "中文: " + c["zh"]}]})
            enriched += 1
    json.dump(d, open(dpath, "w"), ensure_ascii=False)
    print(f"{lang}: +{added} from vocab metadata, {enriched} enriched | total {len(d)} | {os.path.getsize(dpath)//1024} KB")
