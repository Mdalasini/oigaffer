#!/bin/bash
# Runs a command in one of SIM_SLOTS machine-wide slots, so several agents in different worktrees
# can't pile 40 simulation processes onto the CPU. Waits for a free slot, frees it on exit.
# Usage: bash slot.sh <command...>
#   SIM_SLOTS=6        processes allowed at once across every worktree (the M5 has 4 P + 6 E cores)
#   SIM_QOS=utility    utility costs ~10% speed; background stays on E-cores (cool but ~3.5x slower)
set -u
slots=${SIM_SLOTS:-6}
dir=${SIM_SLOT_DIR:-$HOME/.cache/oigaffer-sim-slots}
mkdir -p "$dir"

slot=""
while [ -z "$slot" ]; do
  for i in $(seq 1 "$slots"); do
    d="$dir/$i"
    if mkdir "$d" 2>/dev/null; then echo $$ > "$d/pid"; slot=$d; break; fi
    # A holder that was killed (crashed agent, kill -9) never released its slot.
    pid=$(cat "$d/pid" 2>/dev/null || true)
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then rm -rf "$d"; fi
  done
  [ -z "$slot" ] && sleep 1
done
trap 'rm -rf "$slot"' EXIT
trap 'exit 143' INT TERM

if [ "${SIM_QOS:-utility}" = background ]; then taskpolicy -b "$@"; else taskpolicy -c utility "$@"; fi
