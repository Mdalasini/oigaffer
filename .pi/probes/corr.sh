#!/bin/bash
# Strength->GD correlation on 10 unseen worlds (seasons 7-16), ~900 matches. Run from the worktree root.
bash probes/slot.sh bun probes/corr.ts "$PWD/src" 7 5 & bash probes/slot.sh bun probes/corr.ts "$PWD/src" 12 5 & wait
