# simplify-repo-with-tests — reference

## Headless policy

| User said | E2E mode |
|-----------|----------|
| nothing about UI | **headless** (default) |
| `headless` | headless (same as default) |
| `headed` / `visible` / `ui` | headed / UI mode per runner |

Do **not** ask “headless?” — default is headless.

## What is over-engineering (pointer)

Full catalogs live under the installed **`simplify-code`** skill:

| Axis | simplify-code file |
|------|----------------|
| Line smells | `references/line-smells.md` |
| Structure smells | `references/structure-smells.md` |
| Ceremony / tool-slop | `references/ceremony-smells.md` |

Load that skill; do not paste catalogs into reports beyond short quotes needed as proof.

### One-line reminders (not a second catalog)

- Pass-through wrappers, identity helpers, single-implementation interfaces → delete/inline
- Generic locals (`data`, `result`, `payload`, `response`, `body`, `row`, `temp`) → name the domain concept or drop the hop
- `toX` / `buildX` / `resolveX` / `mapX` layers that only remap identical shapes → collapse
- Folders deeper than the concepts they hold; one-export-per-file explosions; layer-first trees for tiny apps
- House scripts that only shell an official CLI; orphan generated files

## Principles (simple — Clean Code + modern TS habits)

Distilled for agents. Not a transcript dump. Sources: Uncle Bob clean-code themes (YAGNI, small focused units, names that say intent, tests that enable safe change) and Matt Pocock-style TS (types at boundaries, avoid premature abstraction, prefer straightforward functions over ceremony). Optional refresh via `yt-captions-mini-ai` / `ytcap` when authoring deeper doctrine skills.

1. **Less code that still does the job** — every line is a cost; pay only for real behavior, real errors, real domain names.
2. **YAGNI** — no knobs, interfaces, or folders “for later” without a second real caller today.
3. **Names over layers** — a clear function name beats `toDto(buildModel(resolveData(payload)))`.
4. **One job per unit** — if the name needs “and”, split *or* you are looking at a god-function (structure twin of over-nesting).
5. **Errors are part of the product** — lean must not swallow failures that product code currently surfaces.
6. **Types earn their place at boundaries** — decode once at the edge; do not hand-roll `isRecord` ladders mid-pipeline when a schema exists.
7. **Tests protect behavior, not furniture** — assert user-visible rules and domain invariants; do not freeze private helper names you intend to delete.
8. **Boy scout, not big-bang rewrite** — smallest deletion per kill; re-prove; next kill.

## Test-slop (fourth axis — owned here)

A test is **slop** when removing the product’s *business* rule would leave the test green, or when the test only exists to prop up structure:

| Smell | Example | Action |
|-------|---------|--------|
| Structure lock | asserts file path count, barrel export list, private wrapper called N times | delete after lean |
| Internal name lock | spies on `resolvePayload` / `toViewModel` you are deleting | rewrite to assert domain outcome |
| Duplicate theater | three tests same happy path different mock setup | keep one clear test |
| Mock-away domain | MSW/nock returns success and test never hits real validation code under unit | move assertion to unit without mock, or test the validator directly |
| Snapshot of noise | huge snapshots of incidental markup/JSON | narrow to business fields |
| Ceremony CI | test that only runs a house typegen/script | delete with the script |

**Keep** tests that fail if: auth deny, validation reject, wrong total, missing entity, idempotent double-submit, empty state UX, permission edge — even if implementation becomes fewer files.

## Sub-agent scan return template

```markdown
## feature_id: <id>
paths: <globs>

### behavior_must_remain
- happy: …
- errors: …

### kills
| pri | path:symbol | axis (line\|structure\|ceremony\|test-slop) | proof | Δfiles | Δloc≈ | before | after | risk |
|-----|-------------|---------------------------------------------|-------|--------|-------|--------|-------|------|
| P0 | src/foo/makeRequest.ts | line | only caller; rethrows | 1 | -40 | 3 wrappers | fetch+decode | low |

### parity_needed_first
| layer | behavior | suggested path |
|-------|----------|----------------|

### notes
- framework layout constraints: …
```

## Orchestrator summary table

```markdown
| Feature | Hits | Kill files | LOC≈ | Test-slop | Parity gaps | Top proof |
|---------|-----:|-----------:|-----:|----------:|------------:|-----------|
| auth    | 6    | 4          | -220 | 2         | 1           | UserService pass-through |
```

## Apply order

1. Parity tests for high-risk kills  
2. Line-level inlines (wrappers, remaps)  
3. File merges (one-export explosion)  
4. Folder flatten (structure)  
5. Ceremony delete (scripts + orphans)  
6. Test-slop delete/rewrite  
7. Full unit + headless e2e  

## Anti-triggers

| Ask | Use instead |
|-----|-------------|
| Make this block readable / rename | `make-code-readable` |
| Kill ceremony on one file, no prove campaign | `simplify-code` |
| Adopt the personal rules | `code-style` |
| Only add missing tests | `find-missing-tests` |
| Ship one product feature to main | `ship-one-feature` |
| Multi-feature backup main + PRs | `clean-repo-by-feature` (can host simplify-repo-with-tests per lane) |

## Anti-patterns

- Deleting structure **before** any behavior test exists for the risk surface  
- Rewriting architecture under the banner of “lean”  
- Duplicating simplify-code catalogs inside this skill  
- Keeping tests that only lock deleted helper names  
- Headed browser by default  
- Claiming same behavior without running the repo’s unit + e2e commands  
- Merging to main without user asking  

## Optional caption refresh (authoring / deeper doctrine)

When expanding principles (not required every run):

```bash
# Uncle Bob clean-code playlist — filter to his sessions by title/metadata when scraping
ytcap url='https://www.youtube.com/watch?v=7EmboKQH8lM&list=PLUxszVpqZTNShoypLQW9a4dEcffsoZT4k' \
  lang=en output-format=txt out-dir=./scraped-yt/uncle-bob

# Matt Pocock — long-form + shorts, last 1 year
ytcap url='https://www.youtube.com/@mattpocockuk/videos' since=YYYY-MM-DD lang=en out-dir=./scraped-yt/matt-pocock
ytcap url='https://www.youtube.com/@mattpocockuk/shorts' since=YYYY-MM-DD lang=en out-dir=./scraped-yt/matt-pocock-shorts
```

Use `yt-captions-mini-ai` in the workspace. Prefer short distilled bullets in skills over shipping raw captions.
