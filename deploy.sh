#!/bin/bash
# Publish GuessWord.
#
# Default (no flags): build site/ and publish to the self-hosted server (loongsite VPS) via
# deploy-vps.sh — incremental sha256 manifest, ssh upload, atomic switch + engine restart + smoke.
#
# Cloudflare Pages was retired on 2026-10-16 (project `guessword` deleted: every
# <hash>.guessword-173.pages.dev URL and guessword.cc.cd are gone), so the old two-phase
# Pages deploy is kept here only behind GW_CF=1 for the day a CF mirror is resurrected
# (recreating the Pages project first). Credentials for that path come from the environment
# or from the gitignored deploy.local.env next to this script.
set -e
cd "$(dirname "$0")"

if [ "${GW_CF:-0}" = "1" ]; then
  if [ -f deploy.local.env ]; then source deploy.local.env; fi
  : "${CLOUDFLARE_API_TOKEN:?need CLOUDFLARE_API_TOKEN (set env or create deploy.local.env)}"
  : "${CLOUDFLARE_ACCOUNT_ID:?need CLOUDFLARE_ACCOUNT_ID}"
  export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

  # phase 1 uploads data and yields this deployment's permanent hash alias;
  # phase 2 rebuilds the shell with that alias as the second chunk origin (dual TCP flows).
  node build-variant.mjs
  cd site
  OUT1=$(wrangler pages deploy . --branch=main --commit-dirty=true 2>&1) || { echo "$OUT1"; exit 1; }
  URL1=$(echo "$OUT1" | grep -o 'https://[a-z0-9-]*\.guessword-173\.pages\.dev' | head -1)
  if [ -z "$URL1" ]; then echo "phase1 deploy output:\n$OUT1"; exit 1; fi
  echo "phase1 deployed: $URL1"
  cd ..
  node build-variant.mjs "$URL1"
  cd site
  OUT2=$(wrangler pages deploy . --branch=main --commit-dirty=true 2>&1) || { echo "$OUT2" | tail -8; exit 1; }
  echo "$OUT2" | tail -4
  cd ..
fi

# deploy-vps.sh rebuilds site/ with an empty SECHOST (same-origin only) before packaging,
# so never take the site/ it leaves behind and hand it to wrangler.
bash deploy-vps.sh
