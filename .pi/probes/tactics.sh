#!/bin/bash
# Tactical balance: each setting vs a balanced 4-4-2. Usage: bash probes/tactics.sh [matches=400]
# 10 settings x 400 matches is the most expensive probe; 100 only catches gross breakage (±0.25 ppg noise).
cd "$(dirname "$0")"
N=${1:-400}
for cfg in "4-4-2 0" "4-4-2 -2" "4-4-2 -1" "4-4-2 1" "4-4-2 2" "5-4-1 0" "5-3-2 0" "4-5-1 0" "4-3-3 0" "3-4-3 0"; do bash slot.sh bun tactics.ts $cfg $N & done; wait
