#!/usr/bin/env bash
# deploy-vps.sh —— 把 GuessWord 构建产物发布到自有服务器（154.40.58.207，走 loongsite-vps 别名）。
#
# 用法：
#   bash deploy-vps.sh                  # 无参 rebuild（SECHOST 置空）→ 增量同步 → 服务器原子发布
#   GW_SKIP_BUILD=1 bash deploy-vps.sh  # 不 rebuild，直接同步当前 site/
#
# 说明：
# - 首次/全量：上传全部文件；之后按内容 sha256 增量，只传变化文件（常规迭代几百 KB）。
#   服务器端 current 里存有 .gw-manifest，本脚本每次从服务器拉取做对比。
# - 依赖：本机 python（算哈希）、tar、ssh（走 loongsite-vps 别名，含 TLS 隧道；传包用 ssh+cat）。
# - 非交互、可重入；任何一步失败即非零退出（调用方可按需非致命处理）。
# - 注意：本脚本无参 rebuild 产出的 site/ 不含 SECHOST（不回退 CF），不要拿它再 wrangler 部署。
set -euo pipefail
cd "$(dirname "$0")"

ALIAS="${GW_VPS_ALIAS:-loongsite-vps}"
SSHRUN=(ssh -o BatchMode=yes -o ConnectTimeout=20)   # explicit, so a missing alias config fails fast instead of hanging
SITE="site"
TMP="${TMPDIR:-/tmp}/gw-vps-$$"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP"

if [ "${GW_SKIP_BUILD:-0}" != "1" ]; then
  echo "[1/5] rebuild（node build-variant.mjs，无参）"
  node build-variant.mjs | tail -3
else
  echo "[1/5] 跳过 rebuild"
fi
[ -f "$SITE/index.html" ] || { echo "x site/index.html 不存在"; exit 1; }

echo "[2/5] 计算清单并取服务器当前清单"
python - "$SITE" "$TMP/new.tsv" <<'PY'
import hashlib, os, sys
root, out = sys.argv[1], sys.argv[2]
rows = []
for dirpath, _, files in os.walk(root):
    for f in files:
        p = os.path.join(dirpath, f)
        rel = os.path.relpath(p, root).replace('\\', '/')
        h = hashlib.sha256(open(p, 'rb').read()).hexdigest()
        rows.append(f"{h}  {rel}")
rows.sort(key=lambda r: r.split('  ', 1)[1])
open(out, 'w', encoding='utf-8', newline='\n').write("\n".join(rows) + "\n")
print(f"  本地 {len(rows)} 个文件")
PY

"${SSHRUN[@]}" "$ALIAS" 'cat /var/www/guessword/current/.gw-manifest 2>/dev/null' > "$TMP/old.tsv" || true
if [ ! -s "$TMP/old.tsv" ]; then echo "  服务器无清单 → 全量上传"; : > "$TMP/old.tsv"; fi

python - "$TMP" <<'PY'
import os, sys
tmp = sys.argv[1]
def load(p):
    d = {}
    if os.path.exists(p):
        for line in open(p, encoding='utf-8'):
            line = line.rstrip('\n')
            if not line:
                continue
            h, rel = line.split('  ', 1)
            d[rel] = h
    return d
new = load(os.path.join(tmp, 'new.tsv'))
old = load(os.path.join(tmp, 'old.tsv'))
changed = sorted(r for r, h in new.items() if old.get(r) != h)
deleted = sorted(r for r in old if r not in new)
open(os.path.join(tmp, 'changed.txt'), 'w', encoding='utf-8', newline='\n').write("\n".join(changed) + ("\n" if changed else ""))
open(os.path.join(tmp, 'deleted.txt'), 'w', encoding='utf-8', newline='\n').write("\n".join(deleted) + ("\n" if deleted else ""))
print(f"  变化 {len(changed)} 个 / 删除 {len(deleted)} 个")
PY

if [ ! -s "$TMP/changed.txt" ] && [ ! -s "$TMP/deleted.txt" ]; then echo "[5/5] 无变化，跳过上传"; exit 0; fi

echo "[3/5] 打包增量"
mkdir -p "$TMP/root"
cp "$TMP/new.tsv" "$TMP/root/.gw-manifest"
cp "$TMP/deleted.txt" "$TMP/root/.gw-deleted"
tar -czf "$TMP/site.tar.gz" -C "$SITE" -T "$TMP/changed.txt" -C "$TMP/root" .gw-manifest .gw-deleted
echo "  包大小 $(du -h "$TMP/site.tar.gz" | cut -f1)"

echo "[4/5] 上传 + 服务器发布"
# 用 ssh+cat 传输（隧道下 MSYS scp 会 lost connection；cat 经 ssh 是二进制安全的）
"${SSHRUN[@]}" "$ALIAS" 'cat > /var/www/guessword/incoming/site.tar.gz' < "$TMP/site.tar.gz"
"${SSHRUN[@]}" "$ALIAS" 'bash /usr/local/bin/gw-publish'
echo "[5/5] 完成"
