#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash probes/slot.sh bun run calibrate 6
