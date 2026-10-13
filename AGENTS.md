# Working in this repo

Conventions for anyone changing this repo, people and agents alike.

## Branches and pull requests

- Never commit to `main`. Start every change on a new branch from an up-to-date `main`.
- Get changes into `main` through a pull request against `main`.
- Keep a branch to one purpose. If unrelated work comes up, put it on its own branch.

## Branch names

Name branches `<category>/<short-description>`, in lowercase kebab-case, for example `feat/match-clock` or `fix/offside-line`. Use one of these categories:

| Prefix      | For                                                    |
| ----------- | ------------------------------------------------------ |
| `feat/`     | new behaviour or features                              |
| `fix/`      | bug fixes                                              |
| `refactor/` | restructuring that doesn't change behaviour            |
| `perf/`     | performance improvements                               |
| `test/`     | adding or changing tests only                          |
| `docs/`     | documentation only                                     |
| `chore/`    | tooling, config, dependencies and other housekeeping   |

## Commits

- Commit often: make a commit each time a coherent step works, not one large commit at the end of a branch.
- Each commit wraps related changes. One commit is one logical change, together with the tests and docs that go with it. Don't mix unrelated changes in one commit, and don't split one change across several.
- Write the subject line in the imperative mood ("Add match clock", not "Added match clock"), in about 72 characters or fewer. Use the body to explain why, when the why isn't obvious.

## Scope

- Build one observable behaviour at a time, and get it right before adding the next.
- Add only what that behaviour needs. Don't add mechanics because the finished game will need them (gravity, ball spin, attributes, decision models): add each one in the step that first shows it.
- Every new behaviour gets tests that say what "right" looks like, and is watched in the sandbox before moving on.
- When something looks wrong, find the cause. Don't tune constants until the totals look right; interacting tweaks hide the real fault.
