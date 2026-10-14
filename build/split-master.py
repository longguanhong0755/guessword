"""One-shot: split the single-file master into index.html + css/app.css + js/*.js.
Content-preserving: every line moves verbatim into exactly one output file.
Run from D:/workspace/guessword. Writes build/guessword.presplit.bak.html first.
"""
import os, shutil, re

ROOT = "D:/workspace/guessword"
BAK = os.path.join(ROOT, "build", "guessword.presplit.bak.html")
SRC = os.path.join(ROOT, "guessword.html")
if not os.path.exists(SRC):          # already split once: re-run from the pre-split backup
    SRC = BAK

src = open(SRC, encoding="utf-8", newline="").read()
assert "\r\n" not in src
lines = src.split("\n")          # last element is "" (file ends with \n)
print("lines:", len(lines))

def find(pred, start=0):
    for i in range(start, len(lines)):
        if pred(lines[i]):
            return i
    raise SystemExit("marker not found")

i_style_open = find(lambda l: l.strip() == "<style>")
i_style_close = find(lambda l: l.strip() == "</style>", i_style_open)
i_head_close = find(lambda l: l.strip() == "</head>")
i_script_open = find(lambda l: l.strip() == "<script>")
i_script_close = find(lambda l: l.strip() == "</script>", i_script_open)
i_body_end = find(lambda l: l.strip() == "</body>", i_script_close)
print(i_style_open, i_style_close, i_head_close, i_script_open, i_script_close, i_body_end)

head = lines[:i_style_open]                       # doctype .. favicon link
css = lines[i_style_open + 1:i_style_close]        # style body
mid = lines[i_head_close + 1:i_script_open]        # </head> is re-emitted, so start AFTER it
script = lines[i_script_open + 1:i_script_close]   # js body
tail = lines[i_body_end:]                          # </body>, </html>, ""

# --- split the script body into data files + app ---
data_rx = [
    ("en", re.compile(r"^const GWD=")),
    ("en", re.compile(r"^const GWMAP=")),
    ("en", re.compile(r"^const GWDICT_B64=")),
    ("ja", re.compile(r"^const GW_JA=")),
    ("ja", re.compile(r"^const GWDICT_JA_B64=")),
    ("ko", re.compile(r"^const GW_KO=")),
    ("ko", re.compile(r"^const GWDICT_KO_B64=")),
    ("extra", re.compile(r"^let GW_FR=")),
]
buckets = {"en": [], "ja": [], "ko": [], "extra": []}
app = []
used = set()
for idx, ln in enumerate(script):
    for name, rx in data_rx:
        if rx.match(ln):
            buckets[name].append(ln)
            used.add(idx)
            break
for idx, ln in enumerate(script):
    if idx not in used:
        app.append(ln)
print("data lines:", {k: len(v) for k, v in buckets.items()}, "app lines:", len(app))
assert all(len(v) == (3 if k == "en" else 2 if k in ("ja", "ko") else 1) for k, v in buckets.items())

HEADERS = {
    "en": "/* GuessWord data — English pack (GWD: vocab + Numberbatch 300d int8 vectors; GWMAP: lemma map)\n   and the English dictionary (ECDICT/Wiktionary, gzip+base64). Generated file: edit via build/ scripts. */",
    "ja": "/* GuessWord data — Japanese pack + dictionary (gzip+base64). Generated file. */",
    "ko": "/* GuessWord data — Korean pack + dictionary (gzip+base64). Generated file. */",
    "extra": "/* GuessWord data — fr/de/es placeholders. The real fr/de/es packs live outside the repo\n   (D:/gw-dl/lang/pack-<L>.json, dict-<L>.json) and are injected by build-variant.mjs at deploy time. */",
}
os.makedirs(os.path.join(ROOT, "css"), exist_ok=True)
os.makedirs(os.path.join(ROOT, "js"), exist_ok=True)
for k, body in buckets.items():
    with open(os.path.join(ROOT, "js", f"data-{k}.js"), "w", encoding="utf-8", newline="\n") as f:
        f.write(HEADERS[k] + "\n" + "\n".join(body) + "\n")
with open(os.path.join(ROOT, "js", "app.js"), "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(app) + "\n")
with open(os.path.join(ROOT, "css", "app.css"), "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(css) + "\n")

index = "\n".join(head + [
    '<link rel="stylesheet" href="css/app.css">',
    "</head>",
] + mid + [
    '<script src="js/data-en.js"></script>',
    '<script src="js/data-extra.js"></script>',
    '<script src="js/data-ja.js"></script>',
    '<script src="js/data-ko.js"></script>',
    '<script src="js/app.js"></script>',
] + tail)
with open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8", newline="\n") as f:
    f.write(index)

if os.path.abspath(SRC) != os.path.abspath(BAK):
    shutil.copy2(SRC, BAK)
    os.remove(SRC)
print("wrote index.html, css/app.css, js/{data-en,data-extra,data-ja,data-ko,app}.js")
for p in ["index.html", "css/app.css", "js/app.js", "js/data-en.js", "js/data-extra.js", "js/data-ja.js", "js/data-ko.js"]:
    print("  ", p, f"{os.path.getsize(os.path.join(ROOT, p))/1048576:.2f}MB")
print("backup:", BAK)
