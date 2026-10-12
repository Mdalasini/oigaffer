# Probe harness for engine workflows

Scratch measurement scripts for pi workflows that tune the event engine. Copy them into each
worktree's `probes/` folder (they import `../src`), and never commit them from a worktree.

| Script | Matches | Use |
|---|---|---|
| `bun probes/metrics.ts 60 1` | 60 | animation and pacing metrics as JSON |
| `bash probes/calib.sh` | ~540 | `bun run calibrate 6` |
| `bash probes/corr.sh` | ~900 | correlation and favourite win % on 10 unseen worlds |
| `bash probes/tactics.sh [N]` | 10 × N | tactical balance against a balanced 4-4-2. N=100 only catches gross breakage: it is noisy by about ±0.25 ppg (the mirror match gave 1.66 at 100 and 1.42 at 400). Use 400 for any verdict. |
| `bun probes/tisrc.ts "$PWD"` | 60 | where throw-ins come from |

## CPU limits

Every simulation runs through `slot.sh`, which allows `SIM_SLOTS` (default 6) processes at
once **across all worktrees** and runs them at utility QoS. Set `SIM_QOS=background` to keep
runs on the efficiency cores: the laptop stays cool, but matches are about 3.5× slower. Slots
are directories in `~/.cache/oigaffer-sim-slots`. A slot left behind by a killed process is
reclaimed automatically.

## Shared baseline

`bash .pi/probes/baseline.sh [ref=main]` measures a ref once in a throwaway worktree and writes
`.pi/baseline/<sha>.txt`. Re-run it when `main` moves. Give the file to the agents so they
don't each measure `main` again.

## Prompt snippet for workflows

```
Baseline for main is already measured: read .pi/baseline/<sha>.txt in the main checkout (copied to WT/probes/baseline.txt). Do not re-measure main.
CPU budget: this machine is shared with other agents. All probes queue for a few machine-wide slots, so a run can wait before it starts; that is expected.
Screen variants with calib.sh, which is cheap. Use tactics.sh 100 only to catch a variant that breaks balance badly (it is noisy by about ±0.25 ppg; compare it with the 100-match section of the baseline). Run corr.sh at most 4 times and tactics.sh 400 at most twice (your final candidate and one alternative).
```
