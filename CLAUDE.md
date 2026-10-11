@AGENTS.md

## Notes for Claude

- `AGENTS.md` (imported above) is the source of truth for this repo. Update it, not this file, when project facts change, so other agents see the same guidance.
- The user prefers small, simple steps. Build the minimum a feature needs, and say what was deliberately left out.
- Before designing a larger feature, talk the approach through in plain language if asked. Don't jump to code.
- When tuning the event engine, write throwaway probe and sweep scripts in the scratchpad, not in `src/`. Report calibration and balance numbers honestly, including what is still off.
- Constants sweeps that edit `engine/constants.ts` must restore the file afterwards. Check with `git diff` before committing.
- Run shell loops that split a `"K=V K=V"` string under `bash`. The default shell is zsh, which doesn't word-split unquoted variables.
