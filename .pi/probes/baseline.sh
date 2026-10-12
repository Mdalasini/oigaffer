#!/bin/bash
# Measures a ref once with the whole harness and writes .pi/baseline/<sha>.txt, so workflow agents
# read the baseline instead of each re-measuring main. Runs in a throwaway worktree.
# Usage: bash .pi/probes/baseline.sh [ref=main]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(git -C "$here" rev-parse --show-toplevel)
ref=${1:-main}
sha=$(git -C "$repo" rev-parse --short "$ref")
out="$repo/.pi/baseline/$sha.txt"
mkdir -p "$repo/.pi/baseline"

wt=$(mktemp -d "${TMPDIR:-/tmp}/oigaffer-baseline.XXXX")
git -C "$repo" worktree add --detach "$wt" "$sha" >/dev/null
trap 'git -C "$repo" worktree remove --force "$wt"' EXIT
mkdir -p "$wt/probes" && cp "$here"/*.ts "$here"/*.sh "$wt/probes/"
cd "$wt"

{
  echo "# Baseline: $ref at $sha, measured $(date '+%Y-%m-%d %H:%M')"
  echo; echo "## bash probes/calib.sh"; bash probes/calib.sh
  echo; echo "## bash probes/corr.sh"; bash probes/corr.sh
  echo; echo "## bun probes/metrics.ts 60 1"; bash probes/slot.sh bun probes/metrics.ts 60 1
  echo; echo "## bun probes/tisrc.ts"; bash probes/slot.sh bun probes/tisrc.ts "$PWD"
  echo; echo "## bash probes/tactics.sh 400"; bash probes/tactics.sh 400
  echo; echo "## bash probes/tactics.sh 100 (screening size: noisy by about ±0.25 ppg, so it only shows gross breakage)"; bash probes/tactics.sh 100
} > "$out.tmp"
mv "$out.tmp" "$out"
echo "wrote $out"
