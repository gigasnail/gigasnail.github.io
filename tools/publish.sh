#!/usr/bin/env bash
# gigasnail-site publish: build from content/*.md, commit, push.
# usage: ./tools/publish.sh ["commit message"]
set -euo pipefail
cd "$(dirname "$0")/.."

python3 tools/build.py

git add -A
if git diff --cached --quiet; then
  echo "🐌 nothing new to publish."
  exit 0
fi

git commit -m "${1:-🐌 …}"
git push
echo "🐌 published → https://gigasnail.github.io/ (live in ~1 min)"
