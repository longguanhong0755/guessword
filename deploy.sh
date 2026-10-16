#!/bin/bash
# Two-phase deploy: phase 1 uploads data and yields this deployment's permanent hash alias;
# phase 2 rebuilds the shell with that alias as the second chunk origin (dual TCP flows) and deploys again.
# Credentials come from the environment, or from gitignored deploy.local.env next to this script.
set -e
cd "$(dirname "$0")"
if [ -f deploy.local.env ]; then source deploy.local.env; fi
: "${CLOUDFLARE_API_TOKEN:?need CLOUDFLARE_API_TOKEN (set env or create deploy.local.env)}"
: "${CLOUDFLARE_ACCOUNT_ID:?need CLOUDFLARE_ACCOUNT_ID}"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

cd /d/workspace/guessword
node build-variant.mjs

cd /d/workspace/guessword/site
OUT1=$(wrangler pages deploy . --branch=main --commit-dirty=true 2>&1) || { echo "$OUT1"; exit 1; }
URL1=$(echo "$OUT1" | grep -o 'https://[a-z0-9-]*\.guessword-173\.pages\.dev' | head -1)
if [ -z "$URL1" ]; then echo "phase1 deploy output:\n$OUT1"; exit 1; fi
echo "phase1 deployed: $URL1"

cd /d/workspace/guessword
node build-variant.mjs "$URL1"

cd /d/workspace/guessword/site
OUT2=$(wrangler pages deploy . --branch=main --commit-dirty=true 2>&1) || { echo "$OUT2" | tail -8; exit 1; }
echo "$OUT2" | tail -4

# ---- 自托管同步（loongsite VPS）：过渡期非致命，失败只告警 ----
# deploy-vps.sh 会无参 rebuild（SECHOST 置空）覆盖 site/，别拿之后的 site/ 再 wrangler 部署
if [ -f /d/workspace/guessword/deploy-vps.sh ]; then
  ( cd /d/workspace/guessword && bash deploy-vps.sh ) || echo "WARN: VPS sync failed (CF deploy unaffected)"
fi
