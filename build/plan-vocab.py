# Build the vocab-surgery plan v2: proper-noun removal + inflection merge map.
# v2 fixes: exact inflection glosses only, archaic-sense tolerant standalone(),
# adj-target check + bigger blocklist for -ly, frq guard (ECDICT) against merging
# into a rarer lemma, transitive closure of the map, reviewed answer-level list.
import json, os, re, sqlite3

ROOT = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(ROOT, "..", "guessword.html")
line = next(l.rstrip("\r\n") for l in open(HTML, encoding="utf-8") if l.startswith("const GWD="))
G = json.loads(line[len("const GWD="):-1])
words = G["words"].split("|")
level = G["level"]
vocab = set(words)
lv = dict(zip(words, level))

sub = json.load(open(os.path.join(ROOT, "kaikki-sub.json"), encoding="utf-8"))
exch = json.load(open(os.path.join(ROOT, "ecdict-exchange.json"), encoding="utf-8"))

# ECDICT frequency rank (lower = more frequent; 0/None = unknown)
frq = {}
con = sqlite3.connect("D:/gw-dl/ecdict-extract/stardict.db")
for (w, f) in con.execute("select word, frq from stardict"):
    lw = w.lower()
    if lw in vocab and f:
        frq[lw] = f
con.close()

def freq(w):
    return frq.get(w, 999999)

# ---------------- keep-lists ----------------
MONTHS = set("january february march april may june july august september october november december".split())
DAYS = set("monday tuesday wednesday thursday friday saturday sunday".split())
HOLIDAYS = set("christmas easter halloween thanksgiving ramadan hanukkah diwali valentine eid".split())
COUNTRIES = set("""afghanistan albania algeria andorra angola argentina armenia australia austria azerbaijan bahamas bahrain bangladesh barbados belarus belgium belize benin bhutan bolivia bosnia botswana brazil britain brunei bulgaria burundi cambodia cameroon canada chad chile china colombia comoros congo croatia cuba cyprus czechia denmark djibouti dominica ecuador egypt england eritrea estonia eswatini ethiopia fiji finland france gabon gambia georgia germany ghana greece grenada guatemala guinea guyana haiti honduras hungary iceland india indonesia iran iraq ireland israel italy jamaica japan jordan kazakhstan kenya kiribati korea kuwait kyrgyzstan laos latvia lebanon lesotho liberia libya liechtenstein lithuania luxembourg madagascar malawi malaysia maldives mali malta mauritania mauritius mexico micronesia moldova monaco mongolia montenegro morocco mozambique myanmar namibia nauru nepal netherlands nicaragua niger nigeria norway oman pakistan palau panama paraguay peru philippines poland portugal qatar romania russia rwanda samoa scotland senegal serbia seychelles singapore slovakia slovenia somalia spain sudan suriname sweden switzerland syria taiwan tajikistan tanzania thailand togo tonga tunisia turkey turkmenistan tuvalu uganda ukraine uk uruguay usa uzbekistan vanuatu vatican venezuela vietnam wales yemen zambia zimbabwe america soviet prussia yugoslavia czechoslovakia abyssinia siam burma persia arabia siberia""".split())
NATLANG = set("""afghan african albanian algerian american arab arabic argentinian armenian asian australian austrian bengali brazilian british bulgarian burmese cambodian canadian cantonese catalan chilean chinese colombian croatian cuban czech danish dutch egyptian english estonian ethiopian european filipino finnish flemish french georgian german greek gujarati haitian hebrew hindi hungarian icelandic indian indonesian iranian iraqi irish italian japanese javanese jewish jordanian kannada kazakh kenyan korean kurdish kuwaiti lao latin latvian lebanese lithuanian macedonian malagasy malay malayalam malaysian marathi mexican mongolian moroccan nepali nigerian norwegian pakistani persian peruvian polish portuguese punjabi roman romanian russian scottish serbian singaporean slovak slovenian somali spanish sudanese swahili swedish swiss syrian tamil telugu thai tibetan tunisian turkish turkmen ukrainian urdu uzbek vietnamese welsh yiddish yoruba zulu afrikaans basque belarusian bosnian creole esperanto galician luxembourgish pashto slovakian slovene tajik turkic uighur uygur""".split())
# hand-reviewed answer-level keeps (kaikki data gaps / titles / common initialisms)
KEEP_EXTRA = set("mr mrs ms miss dr prof cv dj hiv clutter".split())
KEEP_PROPER = MONTHS | DAYS | HOLIDAYS | COUNTRIES | NATLANG | KEEP_EXTRA

GLOSS_KEEP = re.compile(r"(country in|sovereign state|language of|nationality|demonym|person from|inhabitant of|month of|day of the week)", re.I)

PLURALE_TANTUM = set("""pants trousers glasses scissors jeans shorts tights clothes pajamas pyjamas goggles binoculars pliers tweezers headphones panties knickers leggings overalls dungarees briefs news physics mathematics maths economics politics athletics gymnastics ethics linguistics statistics series species means headquarters surroundings premises outdoors downstairs upstairs indoors nowadays besides perhaps towards forwards backwards always often sometimes these those billiards belongings savings earnings winnings data goods sales""".split())
# hand-reviewed: never merge these even though sources claim an inflection relation
MERGE_BLOCK = set("born ought founded".split())
# always merge these even if an obscure/regional standalone sense exists
FORCE_MERGE = dict(t.split(":") for t in """mice:mouse said:say came:come got:get ran:run oxen:ox
am:be drove:drive flew:fly woke:wake chose:choose laid:lay met:meet sat:sit won:win paid:pay""".split())
LY_BLOCK = set("""hardly lately really actually literally simply easily shortly presently mostly deadly deathly friendly lonely silly only early likely unlikely daily weekly monthly yearly hourly lowly comely surly costly elderly orderly scholarly lively homely ghastly mannerly timely untimely sisterly brotherly motherly fatherly heavenly earthly worldly poorly barely scarcely surely definitely certainly probably possibly maybe perhaps obviously apparently presumably hopefully thankfully luckily fortunately unfortunately sadly practically virtually basically essentially generally normally usually specially especially mainly partly largely highly merely purely totally absolutely fairly newly solely overly finally firstly secondly thirdly lastly importantly interestingly recently currently frequently constantly occasionally roughly approximately extremely namely""".split())

INFL_RE = re.compile(r"^(plural|simple past|past participle|present participle|comparative|superlative|simple subjunctive|present subjunctive|remote past|first-person singular|second-person singular|third-person singular|first-person plural|second-person plural|third-person plural|first-person|second-person|third-person)\b.{0,40}?\bof ([a-z'-]+)")
# senses carrying these markers are too obscure to defend a word against merging
OBSCURE = {"archaic", "obsolete", "dated", "rare", "historical", "humorous", "nonce",
           "slang", "informal", "vulgar", "colloquial", "dialect", "regional", "nonstandard",
           "Manglish", "Singlish", "Philippines"}
SLANG_GLOSS = re.compile(r"slang|^(dated|archaic|obsolete|rare|colloquial|informal)\b", re.I)

# ---------------- helpers ----------------
def ecdict_inv():
    inv = {}
    REL = {"s": "plural", "p": "verbform", "d": "verbform", "i": "verbform", "3": "verbform", "r": "comparative", "t": "superlative"}
    for w in words:
        x = exch.get(w)
        if not x:
            continue
        for part in x.split("/"):
            if ":" in part:
                k, v = part.split(":", 1)
                rel = REL.get(k)
                if rel and v:
                    inv.setdefault(v.lower(), []).append((w, rel))
    return {f: ls for f, ls in inv.items() if f in vocab}

INV = ecdict_inv()

def pos_of(w):
    return {e["pos"] for e in sub.get(w, [])}

def standalone(w):
    """w carries its own meaning (not merely an inflection/alt-spelling of another word).
    Proper-name (pos 'name') entries, obscure-tagged senses and plural-only senses
    don't count (the runs=dogs=feet cases)."""
    for e in sub.get(w, []):
        if e["pos"] == "name":
            continue
        for s in e["senses"]:
            if s["form_of"] or s["alt_of"]:
                continue
            tags = set(s["tags"])
            if tags & OBSCURE or "plural-only" in tags:
                continue
            if SLANG_GLOSS.search(s["g"]):
                continue
            if INFL_RE.match(s["g"].lower()):
                continue
            return True
    return False

def first_sense_formof(w):
    for e in sub.get(w, []):
        for s in e["senses"]:
            m = INFL_RE.match(s["g"].lower())
            if m:
                return m.group(1), (s["form_of"][0].lower() if s["form_of"] else m.group(2))
            return None
    return None

REL_OK = {"plural", "verbform", "comparative", "superlative", "adverb", "ukspelling"}
merge = {}

def freq_ok(w, L):
    fw, fL = freq(w), freq(L)
    if fL == 999999 and lv[L] == "9":
        return False          # lemma unknown to ECDICT and not an official word: too risky
    return fL <= fw * 2 + 2000

def try_merge(w, L, rel, via):
    if rel not in REL_OK or w in merge or w == L or L not in vocab:
        return False
    if w in PLURALE_TANTUM or w in LY_BLOCK or w in MERGE_BLOCK:
        return False
    if rel == "adverb":
        if "adj" not in pos_of(L):
            return False
    elif rel == "ukspelling":
        pass   # spelling variants legitimately carry their own kaikki entries
    else:
        # no kaikki entry means no evidence; official (answer-level) words stay untouched then
        # (complicated/flatter have real standalone lives that kaikki happens to lack)
        if via in ("ecdict", "rule-fallback") and not sub.get(w) and lv[w] != "9":
            return False
        # rule/ecdict paths have no kaikki inflection evidence: an ECDICT headword whose
        # exchange has no 0:lemma back-reference is a standalone lemma (flatter=奉承), never merge it
        if via in ("ecdict", "rule-fallback"):
            x = exch.get(w)
            if x and "0:" not in x:
                return False
        if standalone(w):
            return False
        if not freq_ok(w, L):
            return False
    merge[w] = {"to": L, "rel": rel, "via": via}
    return True

# (a) kaikki sense-level form_of with EXACT inflection glosses (went->go, mice->mouse, healthier->healthy)
# a word may inflect from several lemmas (does: plural of doe / third-person of do) — pick the most frequent lemma
for w in words:
    cands = []
    for e in sub.get(w, []):
        for s in e["senses"]:
            if set(s["tags"]) & OBSCURE:
                continue
            m = INFL_RE.match(s["g"].lower())
            if not m:
                continue
            L = (s["form_of"][0].lower() if s["form_of"] else m.group(2))
            kind = m.group(1)
            rel = "plural" if kind == "plural" else ("comparative" if kind == "comparative" else ("superlative" if kind == "superlative" else "verbform"))
            cands.append((freq(L), L, rel))
    for _, L, rel in sorted(cands):
        if try_merge(w, L, rel, "kaikki-formof"):
            break

# (b) ECDICT exchange inverse (same most-frequent-lemma selection)
for w in words:
    if w in merge or w not in INV:
        continue
    for _, L, rel in sorted((freq(L), L, rel) for L, rel in INV[w]):
        if try_merge(w, L, rel, "ecdict"):
            break

# (c) UK spelling via kaikki gloss patterns (British/Commonwealth spelling of X)
UK_RE = re.compile(r"(?:British|Commonwealth|Ireland|England|Scotland|UK)(?: and [A-Za-z]+)?(?: standard)? (?:spelling|form|variant) of ([a-z'-]+)", re.I)
for w in words:
    if w in merge:
        continue
    for e in sub.get(w, []):
        for s in e["senses"]:
            m = UK_RE.search(s["g"])
            if m and m.group(1).lower() in vocab:
                try_merge(w, m.group(1).lower(), "ukspelling", "kaikki-gloss")
                break

# (d) -ly adverbs: rule + blocklist + target must be a kaikki-certified adjective
for w in words:
    if w in merge or not w.endswith("ly") or len(w) < 5:
        continue
    L = w[:-2]
    if L not in vocab:
        continue
    if sub.get(w) and "adv" not in pos_of(w):
        continue
    try_merge(w, L, "adverb", "rule-ly")

# (e) rule fallback for words with NO kaikki entry (rare; no er/est — too error-prone)
for w in words:
    if w in merge or sub.get(w):
        continue
    cands = []
    if w.endswith("ies") and len(w) > 4: cands.append((w[:-3] + "y", "plural"))
    if w.endswith("ing") and len(w) > 5: cands += [(w[:-3], "verbform"), (w[:-3] + "e", "verbform")]
    if w.endswith("ed") and len(w) > 4: cands += [(w[:-2], "verbform"), (w[:-2] + "e", "verbform")]
    if w.endswith("s") and len(w) > 3 and not w.endswith(("ss", "us", "is", "ous")): cands.append((w[:-1], "plural"))
    if w.endswith("es") and len(w) > 4: cands.append((w[:-2], "plural"))
    for L, rel in cands:
        if L in vocab and L != w and try_merge(w, L, rel, "rule-fallback"):
            break

# (f) hand-forced irregulars (obscure standalone senses blocked the evidence paths)
for w, L in FORCE_MERGE.items():
    if w not in merge and L in vocab and w in vocab:
        merge[w] = {"to": L, "rel": "plural", "via": "forced"}

# ---------------- 1) proper-noun removal ----------------
def natlang_plural(w):
    for base in (w[:-1], w[:-2] if w.endswith("es") else "", (w[:-3] + "y") if w.endswith("ies") else ""):
        if base in NATLANG or base in COUNTRIES:
            return True
    return False

remove_proper = []
for w in words:
    es = sub.get(w, [])
    if not es:
        continue
    has_common = any(e["word"] == w and e["pos"] != "name" for e in es)
    has_proper = any(e["pos"] == "name" or (e["word"] and e["word"][0].isupper() and e["word"].lower() == w) for e in es)
    if not has_proper or has_common:
        continue
    if w in KEEP_PROPER or natlang_plural(w):
        continue
    glossblob = " ".join(s["g"] for e in es for s in e["senses"])
    if GLOSS_KEEP.search(glossblob):
        continue
    remove_proper.append({"w": w, "lv": lv[w], "gloss": glossblob[:80]})

REMOVE_SET = {r["w"] for r in remove_proper}

# ---------------- transitive closure (coloured->colour->color); removal beats merging ----------------
final = {}
for w in merge:
    seen, cur = set(), w
    while cur in merge and cur not in seen:
        seen.add(cur)
        cur = merge[cur]["to"]
    if cur in vocab and cur not in REMOVE_SET and cur != w and w not in REMOVE_SET:
        final[w] = cur
merged_word_set = set(final)

# ---------------- summary ----------------
by_rel = {}
by_lv_merge = {}
for w, L in final.items():
    r = merge[w]["rel"]
    by_rel[r] = by_rel.get(r, 0) + 1
    by_lv_merge[lv[w]] = by_lv_merge.get(lv[w], 0) + 1
by_lv_proper = {}
for r in remove_proper:
    by_lv_proper[r["lv"]] = by_lv_proper.get(r["lv"], 0) + 1

print(f"proper-noun removal: {len(remove_proper)}  (levels {by_lv_proper})")
print("  sample:", ", ".join(r["w"] for r in remove_proper[:50]))
ans_proper = [r["w"] for r in remove_proper if r["lv"] != "9"]
print(f"  answer-level removals ({len(ans_proper)}):", ", ".join(ans_proper))
print(f"merges: {len(final)}  by relation {by_rel}  by level {by_lv_merge}")
for rel in ("plural", "verbform", "comparative", "superlative", "adverb", "ukspelling"):
    ex = [f"{w}->{L}" for w, L in final.items() if merge[w]["rel"] == rel][:16]
    print(f"  {rel}: {', '.join(ex)}")
ans_merge = [(w, final[w], merge[w]["rel"]) for w in final if lv[w] != "9"]
print(f"  answer-level merges: {len(ans_merge)}")
print("   sample:", ", ".join(f"{w}->{L}" for w, L, _ in ans_merge[:40]))
chains = [(w, final[w]) for w in final if w in merge and merge[w]["to"] != final[w]]
print("  chains resolved:", ", ".join(f"{w}=>{L}" for w, L in chains[:12]))
suspect = sorted(((freq(L) - freq(w), w, L) for w, L in final.items() if merge[w]["rel"] == "plural" and freq(L) > freq(w)), reverse=True)[:20]
print("  suspect plural (lemma rarer than form):", ", ".join(f"{w}->{L}" for _, w, L in suspect))
remaining = len(words) - len(REMOVE_SET) - len(merged_word_set)
print(f"final vocab: {remaining} (removed {len(REMOVE_SET)}, merged away {len(merged_word_set)})")

json.dump(sorted(REMOVE_SET), open(os.path.join(ROOT, "remove-proper.json"), "w"))
json.dump(final, open(os.path.join(ROOT, "merge-map.json"), "w"))
json.dump(remove_proper, open(os.path.join(ROOT, "remove-proper-detail.json"), "w"), ensure_ascii=False, indent=1)
json.dump({w: {"to": final[w], **merge[w]} for w in final}, open(os.path.join(ROOT, "merge-map-detail.json"), "w"), ensure_ascii=False, indent=1)
