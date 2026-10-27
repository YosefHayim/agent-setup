# Restructure repo — examples

One made-up repo runs through every example: an Expo app in `mobile/`, a Cloudflare Worker API in `api/`, and shared types in `common/`. Its `LANGUAGE.md` uses the words **Customer**, **Order**, and **Menu item**.

## Contents

- Scout brief
- Step 1: Start
- Step 3: Safe fixes
- Step 4: Rule scan
- Step 7: Review page
- Phase 1: Dead weight
- Phase 2: Structure
- Phase 3: Code
- Phase 4: Names
- Phase 5: Deps
- Phase 6: Best practices

## Scout brief

Code scout:

```text
You are a read-only scout for restructure-repo, phase 4 (Names).
Area: mobile/**. Do not edit, commit, or propose fixes.
These are the `findings.md` lines for mobile/** (from `grep -A40 '^## mobile/' findings.md`); check each at its file:line first, then read every exported function, type, interface, and prop name, and the comment above each.
Return only this table, one row per finding, no prose. If nothing is found, return "none".
| file:line | kind | name | what it really does (evidence: quote, tool output, or count) |
```

Doc scout (one per framework; this one is for Expo, and the Worker and React get their own):

```text
You are a read-only scout for restructure-repo, step 5 (Official docs).
Fetch the pages for Expo SDK <installed version> on project structure and monorepos.
Return only this table. Quote the page; never paraphrase from memory.
| URL | section | quote (at most 2 sentences) | applies to |
```

## Step 1: Start

Card (illustrative; the real options come from the models this host offers in that session):

> **Which model should the scouts use?**
> 1. **Fastest, cheapest model (Recommended).** Fine for running tools and listing findings; the main agent checks every finding anyway.
> 2. **Mid model.** Reads code and doc pages more carefully and costs more.
> 3. **Same as the main agent.** Most careful and costs the most.

## Step 3: Safe fixes

On `refactor/split-app-and-api`, clean tree:

```bash
pnpm exec biome check --write .
```

Then the `git mv` renames for file names that are not kebab-case, the repo's checks, and one commit: `Apply safe fixes`.

## Step 4: Rule scan

```bash
git grep -n -E "^(export )?(async )?function " -- 'mobile/**/*.ts' 'mobile/**/*.tsx'
git grep -n "from \"\.\./" -- mobile api common
```

Report section:

```text
Rule counts now: parent-imports 386, function-declarations 125, banned-name-words 92, non-kebab-case-files 26
Findings: $RUN_DIR/findings.md
```

## Step 7: Review page

The scouts are done and the main agent checked each finding at its `file:line`. `$RUN_DIR/review.html` has these sections, in this order:

| Section | Holds |
|---|---|
| Rule scan | Counts per rule before the phases, and the top rules |
| Tree | Current tree and proposed tree side by side, then the move table (from, to, why, source) |
| Names | Rename table, and proposed `LANGUAGE.md` swaps from the declared names (`ticker price` to `stock price` when both name one thing) |
| Code | Before and after for the biggest wins, each with its `file:line` |
| Stack fits purpose | Each framework and main library, a verdict against `PROJECT.md`, and the official doc link |
| Deps | Unused files, exports, deps, wrong sections |

The page is one file: inline CSS, `prefers-color-scheme` colors, a `viewport` meta tag, tables inside an `overflow-x: auto` box, no scripts, and every repo string run through an HTML escape. Then:

```bash
open "$RUN_DIR/review.html"
```

> **Which phases should I apply?**
> 1. **Approve all phases (Recommended).** Dead weight, structure, code, names, deps, best practices, in order.
> 2. Pick phases.
> 3. Stop here. Nothing beyond the safe-fixes commit is applied.

## Many repos

Run the step 4 rule scan on each repo under `~/Code`, read-only, and list the repos by number of hits (`32 repos, 1 failed to scan`). Start with the repo with the fewest hits, and give it its own run.

## Phase 1: Dead weight

Scout row:

| file:line | kind | what is there | evidence |
|---|---|---|---|
| `api/src/legacy/syncV1.ts:1` | file | unused file | knip "Unused files"; `git grep syncV1` finds nothing |

Table (first 2 of 3 rows; the review page and the Report section of `report.md` get all 3):

| Remove | Kind | Evidence | Source |
|---|---|---|---|
| `api/src/legacy/syncV1.ts` | file | no importers | knip |
| `mobile/src/old/Banner.tsx` | file | no importers | knip |

Commit: `refactor(dead-weight): remove 3 unused files`

## Phase 2: Structure


Before and after:

```text
before                 after
mobile/                apps/mobile/
api/                   apps/api/
api/wrangler.toml      apps/api/wrangler.toml
common/types.ts        packages/shared/src/order.ts
```

Move table:

| From | To | Why | Source |
|---|---|---|---|
| `common/types.ts` | `packages/shared/src/order.ts` | both apps import it; holds only Order types | <https://docs.expo.dev/guides/monorepos/> |
| `api/` | `apps/api/` | one folder per deployable app | <https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/> |

Risks: every import of `common/types`, the Metro config (check it against the Expo monorepo guide), and the Worker's root directory in the Cloudflare build settings.

Commit: `refactor(structure): split into apps/mobile, apps/api, and packages/shared`

## Phase 3: Code

Scout row:

| file:line | kind | what is there | evidence |
|---|---|---|---|
| `apps/mobile/src/api/orders.ts:8`, `apps/mobile/src/api/menu.ts:6` | repeated code | the same fetch, status check, and JSON parse | 14 identical lines in each |


Before:

```ts
const response = await fetch(`${API_URL}/orders/${id}`);
if (!response.ok) throw new Error(`Request failed: ${response.status}`);
return response.json();
```

After:

```ts
return fetchJson<Order[]>(`/orders/${id}`);
```

Import order comes from the repo's formatter (`biome check --write` here), never from hand-sorting.

Commit: `refactor(code): share one fetchJson between orders and menu`

## Phase 4: Names

Scout row:

| file:line | kind | name | what it really does |
|---|---|---|---|
| `apps/mobile/src/lib/utils.ts:12` | function | `handleData` | returns `"$12.00"` from cents: `` `$${(cents / 100).toFixed(2)}` `` |


Table:

| Before | After | Why | Source |
|---|---|---|---|
| `utils.ts › handleData()` | `formatPrice.ts › formatPrice()` | says what it returns | `LANGUAGE.md`: "price" |
| `interface IUserData` | `interface Customer` | the domain word | `LANGUAGE.md`: "Customer" |

Names over comments. Before:

```ts
/** Gets the orders for a customer from the API */
export async function getData(id: string) {
```

After, with no comment:

```ts
export async function fetchCustomerOrders(customerId: string) {
```

Commit: `refactor(names): name files and functions after what they do`

## Phase 5: Deps

Scout row:

| file:line | kind | what is there | evidence |
|---|---|---|---|
| `apps/mobile/package.json:18` | dep | `axios` | 2 imports, both plain GET requests |


Table:

| Dep | Where | Action | Why | Source |
|---|---|---|---|---|
| `axios` | mobile | remove | `fetch` covers both calls | <https://reactnative.dev/docs/network> |
| `@types/node` | mobile `dependencies` | move to `devDependencies` | types only; not used at runtime | judgment |
| `expo-image` | mobile | keep | shows Menu item photos | — |

Commit: `refactor(deps): replace axios with fetch and move type packages to devDependencies`

## Phase 6: Best practices

Scout row (doc scout quote plus code scout row):

| file:line | what is there | doc quote | URL |
|---|---|---|---|
| `apps/api/src/env.ts:1` | hand-written `interface Env` | `wrangler types` generates "`Env` types based on your Worker bindings" | <https://developers.cloudflare.com/workers/languages/typescript/> |
| `apps/mobile/src/screens/OrderTotal.tsx:12` | `useEffect` sets `total` from `items` | "When something can be calculated from the existing props or state, don't put it in state. Instead, calculate it during rendering." | <https://react.dev/learn/you-might-not-need-an-effect> |


Table:

| Finding | file:line | Fix | Effort | Source |
|---|---|---|---|---|
| hand-written `Env` | `apps/api/src/env.ts:1` | run `wrangler types`; import the generated `Env` | small | Workers TypeScript docs |
| total kept in an effect | `apps/mobile/src/screens/OrderTotal.tsx:12` | `const total = sum(items)` during render | small | React docs |

With an Express API, the same phase reads the Express [error handling](https://expressjs.com/en/guide/error-handling.html) and [security](https://expressjs.com/en/advanced/best-practice-security.html) pages instead.

Commit: `refactor(best-practices): generate Worker Env types and derive the Order total in render`
