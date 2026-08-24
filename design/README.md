# design

Why this rewrite looks the way it does.

These are working notes from the analysis that preceded the rewrite, not polished
specification. They are kept because most of the decisions here are non-obvious, and because
several of them were reversed once the code was actually measured — reading only the final
answer would hide the reasoning.

## Start here

| document | what it settles |
|---|---|
| [decisions.md](decisions.md) | The decisions taken and who they came from. Read this first. |
| [worklog](../.claude/agents/_worklog.md) | What is done, what is next. Not tracked — working state. |

## Analysis

| document | subject |
|---|---|
| [observation-findings.md](observation-findings.md) | How an AI can read the world at all. The longest and most consequential thread. |
| [geometry-comparison.md](geometry-comparison.md) | This repo's geometry against `makecode-minecraft-geometry-ext`, measured over 37 shared cases. |
| [tool-surface-audit.md](tool-surface-audit.md) | Where the current tool descriptions disagree with the code. |
| [ax-design.md](ax-design.md) | How the tools should look to the model driving them. |
| [localization-data.md](localization-data.md) | Block id ↔ display name tables, and why they matter for reading blocks. |

## Results

| document | outcome |
|---|---|
| [golden-extraction-result.md](golden-extraction-result.md) | The regression baseline: 68 cases, and why a plain golden test would have been the wrong shape. |
| [geoext-fixes-result.md](geoext-fixes-result.md) | Seven geometry bugs found and fixed in the MakeCode extension. |
| [socketbe-phase1-result.md](socketbe-phase1-result.md) | Recovering the `action:agent` response frames socket-be discards. |
| [socketbe-fork-plan.md](socketbe-fork-plan.md) | The plan that work followed. |
| [live-verification-plan.md](live-verification-plan.md) | The 30 things that still need a running copy of Minecraft. |

## Patches

`patches/` holds changes for **other** repositories, produced here because that is where the
analysis happened:

- `socketbe-phase1.patch` — for `Mming-Lab/SocketBE`
- `geoext-fixes.patch` — for `Mming-Lab/makecode-minecraft-geometry-ext`

Both include their own tests. Neither has been applied or pushed.

## A caveat worth keeping

Several conclusions in these notes were wrong before they were right, and the corrections are
left in place rather than edited away. The clearest example: `testforblock` was described as
returning only a yes/no answer — that is what the wiki documents — until a working
implementation showed the response carries the actual block name. Reading the wiki was not
enough; reading someone's running code was.
