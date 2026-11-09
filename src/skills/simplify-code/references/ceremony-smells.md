# Ceremony & tool-slop smells

Third axis of over-engineering (with line-smells + structure-smells). This is **noise that exists because agents and humans reimplemented what a framework/service CLI already ships**, plus the generated files and tests that only exist to prop up that ceremony.

**The tool-first test:** *If the framework, SDK, package manager, or cloud CLI already does the job, do not write a house script, typegen, wrapper, or parallel type system. Call the tool. Custom code earns a place only when it adds product-specific glue the tool cannot express.*

Grill (`code-style`) **detects** these families on every run. `simplify-code` **kills** them after approval. Generated artifacts die with the custom script that produced them.

---

## C1 — Tool-wrapper scripts

```txt
Before                                              After
scripts/deploy.ts  → execFile('wrangler', ['deploy'])   package.json: "deploy": "wrangler deploy"
src/scripts/format.ts → spawn biome                     package.json: "check": "biome check ."
scripts/typecheck-all.ts → tsc -b packages/*            package.json: "typecheck": "tsc -b"
```

**Smell:** a file whose only job is to shell one official CLI with no product env, no multi-step product glue, no validation beyond what the tool already does.

**Kill:** delete the wrapper; point `package.json` (or CI) at the tool.

---

## C2 — House typegen / drift theater

```txt
Before                                                         After
src/scripts/cloudflareTypes.ts + Cli + 5 test files              "cf:types": "wrangler types"
  UUID workspaces, header canonicalize, empty-env hacks
src/scripts/drizzleSchema.ts re-generates kit snapshot + diffs  "db:generate": "drizzle-kit generate"
```

**Smell:** reimplementing `wrangler types`, `drizzle-kit`, OpenAPI generators, etc., then adding check modes, process groups, and large test suites around the reimplementation.

**Kill:** official CLI only. Commit or regenerate the official artifact if the project wants it tracked — without a second generator.

---

## C3 — Wrong tool for the type job

| Need | Prefer | Not |
| --- | --- | --- |
| Worker / binding types (`Env`, `DB: D1Database`) | `wrangler types` | House CF typegen |
| SQL migrations | ORM kit (`drizzle-kit`) + apply CLI (`wrangler d1 migrations apply`) | Custom snapshot comparators |
| Row / column types (`Site`, `User`) | Schema SSOT + infer (`$inferSelect`, Prisma client, etc.) | Wrangler as row types; hand-copied interfaces; dual schemas |

```ts
// ✓ bindings
// wrangler types → Env.DB: D1Database

// ✓ rows
export type Site = typeof sites.$inferSelect;

// ✗ second hand-rolled Site interface + custom D1→TS pipeline
```

**Smell:** inventing a type pipeline because “we need types for D1 tables” when the ORM schema already is the type source, and wrangler only types bindings.

---

## C4 — Scripts dump outside product lifecycle folders

```txt
Before                         After
src/scripts/*                  scripts/dev/          # local product helpers only
src/apps/web/scripts/*         scripts/production/   # ship/prod product helpers only
scripts/*.ts (flat dump)       (delete pure tool wrappers)
scripts/ci|tools|utils/        (no third nest — CI calls a tool or a thin file under dev|production)
```

**Rules for a custom script to live:**

1. It **serves the product** in development or production (seed, lean env→deploy, product asset no tool ships).
2. It lives under **`scripts/dev/`** or **`scripts/production/`** only.
3. It is **lean** — especially env-for-deploy: load required env (fail if missing), then hand off to the tool. No orchestrator class.

**Kill:** relocate product glue into the two nests; delete tool wrappers and agent-hygiene scripts that are not product.

---

## C5 — Orphan generated artifacts

```txt
Before                                      After
*.generated.ts only written by dead script  delete file + script
styleCheck.ts + styleCheck.test.ts (88kb)   biome check
blogManifest.generated.json if product gone delete
```

**Smell:** committed outputs that exist only because a custom generator wrote them, after the generator is no longer justified — or generators for marketing fluff that no longer ships the product.

**Rule:** *when the custom script dies, its generated-only ceremony dies with it* (or stop committing the artifact and regenerate with the official CLI when needed).

---

## C6 — Parallel type / schema systems

```ts
// ✗ hand-rolled vendor payload types when a package already extends the SDK
interface OurLsSubscription { payment_processor?: string }

// ✓ depend on the maintained types package / SDK
import type { LatestSubscriptionFields } from 'fresh-squeezy';

// ✗ Effect Schema that re-models the entire vendor API "for safety"
// ✓ map only product-owned fields at the boundary
```

**Smell:** second schema/interface layer for a third-party payload when the SDK (or a thin extension package) already types it. Drift is guaranteed.

---

## C7 — Logging ceremony (`console.*` scatter)

```ts
// ✗
console.log('activating', paid);
console.error('site missing', siteId);

// ✓ structured, one mute switch (project picks Effect.log* / pino / …)
yield* Effect.logInfo('activate_site_ok', { siteId: site.id });
// production: LOG_LEVEL=none (or equivalent) silences everything from one env
```

**Smell:** ad-hoc `console.log/error/warn` so production noise cannot be killed from one env-driven logger. Customer-facing browser bundles that `console.error` install mistakes.

**Prefer:** one logging API + one env (`LOG_LEVEL` or project equivalent). Widget/customer scripts: fail quiet when appropriate.

---

## C8 — Micro-files and generic locals (ceremony cousins)

Already overlap line/structure smells; flag them in ceremony scans when they appear as **folder noise**:

- New file for ~5–15 lines / one helper with a single caller → colocate.
- Locals named `result`, `data`, `row`, `outcome`, `res`, `temp` after `Effect.runPromise` or SQL → name the domain thing (`activated`, `site`, `heartbeatOutcome`).

---

## How the scan reports (for grill + simplify-code)

For each C1–C8 hit, report:

| Field | Example |
| --- | --- |
| Family | `C1 tool-wrapper` |
| Path | `src/scripts/cloudflareTypes.ts` |
| Official tool that replaces it | `wrangler types` |
| Generated orphans to delete with it | `…` (or none) |
| Product value left after kill? | yes → thin keep under `scripts/{dev,production}` / no → full delete |

Bring back a **kill list** sorted by easy wins (pure wrappers first), not a prose essay.
