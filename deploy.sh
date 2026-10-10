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
wrangler pages deploy . --branch=main --commit-dirty=true 2>&1 | tail -4
