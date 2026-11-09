# Line-level over-engineering smells

Each smell shows a **plain (general TS/web)** before/after and, where it adds signal, an **Effect-flavored** variant (for repos on `effect`). Adapt names to the real repo. The rule of thumb for every one: the extra code must buy something real — a retry, a parse, a typed error, a named concept — or it is deleted.

---

## Family 1 — Needless indirection

### 1. Pass-through `fetch`/call wrapper

Plain:

```ts
// Before — 5 layers to do one GET
async function makeRequest(url, opts) { return doFetch(url, opts); }
async function doFetch(url, opts) { return safeFetch(url, opts); }
async function safeFetch(url, opts) {
  try { return await fetch(url, opts); } catch (e) { throw e; } // re-throws unchanged
}
const getUser = (id) => makeRequest(`/users/${id}`, { method: "GET" });
```

```ts
// After — one call; a wrapper only survives if it retries, parses, types, or maps errors
const getUser = (id: string): Promise<User> =>
  fetch(`/users/${id}`).then((r) => r.json() as Promise<User>);
```

Effect:

```ts
// Before — Effect wrapper that only forwards
const runRequest = (url: string) => Effect.tryPromise(() => fetch(url));
const fetchUser = (id: string) => runRequest(`/users/${id}`);
```

```ts
// After — the wrapper earns its place only when it adds decode + typed error
const fetchUser = (id: string): Effect.Effect<User, FetchUserError> =>
  Effect.tryPromise({ try: () => fetch(`/users/${id}`), catch: () => new FetchUserError({ id }) })
    .pipe(Effect.flatMap((r) => Schema.decodeUnknown(UserSchema)(r)));
```

**Smell:** a layer that neither retries, parses, types, nor maps errors. Delete it.

### 6. One-line helper that hides meaning

```ts
// Before
const inc = (n: number) => n + 1;
const isPos = (n: number) => n > 0;
const not = (b: boolean) => !b;
if (not(isPos(count))) total = inc(total);
```

```ts
// After — the expression is clearer than its name
if (count <= 0) total += 1;
```

**Smell:** a one-line wrapper around a single operator. It adds a lookup, not a concept. (Keep it only if the name is a real domain term reused across the codebase.)

### 12. Class/manager that is really one function

```ts
// Before
class SlugManager { static make(t: string) { return t.toLowerCase().replace(/\s+/g, "-"); } }
SlugManager.make(title);
```

```ts
// After
const slugifyTitle = (title: string): string => title.toLowerCase().replace(/\s+/g, "-");
```

**Smell:** a `Manager`/`Service`/`Helper`/`Handler` class with one static method and no state.

### The identity wrapper (reference anti-example)

```ts
// Before — adds an import + a doc block while doing nothing
export const createJsonlProviderAdapter = (adapter: ProviderAdapter): ProviderAdapter => adapter;
const codex = createJsonlProviderAdapter({ id: "codex", /* ... */ });
```

```ts
// After — inline the literal
const codex: ProviderAdapter = { id: "codex", /* ... */ };
```

**Smell:** `(x) => x`. The purest form of the whole skill.

---

## Family 2 — Fake robustness

### 4. `??` fallback confetti

```ts
// Before — defaults smeared across the workflow
const name = cfg.name ?? user.name ?? "anon";
const root = cfg.root ?? env.root ?? process.cwd() ?? ".";
const limit = opts.limit ?? cfg.limit ?? DEFAULTS.limit ?? 50;
```

```ts
// After — apply defaults once at the boundary, pass a clean value down
const settings = loadSettings(config, environment, overrides); // all defaults applied here
// deeper code reads settings.name / settings.root / settings.limit directly
```

**Smell:** the same `??` chains repeated deep in logic. Apply defaults once at the edge.

### 10. Hand-rolled type guards where a schema belongs

```ts
// Before
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
if (isRecord(json) && typeof json.title === "string") title = json.title;
```

```ts
// After (Effect / zod repos) — let the schema own the boundary
const { title } = yield* Schema.decodeUnknown(SessionHeaderSchema)(json);
```

**Smell:** manual `typeof` / `null` / `Array.isArray` ladders where a validator already exists.

### 14. Deep optional chaining that hides a modeling gap

```ts
// Before
const city = order?.customer?.address?.city ?? "unknown";
```

```ts
// After — validate the shape once, then trust it
const order = yield* Schema.decodeUnknown(OrderSchema)(raw);
const city = order.customer.address.city; // guaranteed present
```

**Smell:** `a?.b?.c?.d` past two hops usually means the type is too loose upstream.

### 16. Swallowed errors returning null/empty

```ts
// Before — failure disappears
try { return parse(raw); } catch { return null; }
```

```ts
// After — model the failure as a typed error
const parsed = yield* decodeSession(raw); // fails with SessionDecodeError
```

**Smell:** `catch { return null }` / empty `catch {}` that hides why something failed.

### 17. Speculative config knobs nobody calls (YAGNI)

```ts
// Before — options invented "for later"
const pack = (s: Session, opts?: {
  algorithm?: "zstd" | "gzip" | "brotli"; // only zstd is ever passed
  parallelism?: number;                    // unused
  retries?: number;                         // unused
}) => ...;
```

```ts
// After — take only what today's callers use
const pack = (session: Session): Effect.Effect<Archive, PackError> => ...;
```

**Smell:** parameters or branches with exactly one real value in the whole codebase.

---

## Family 3 — Control-flow contortion

### 2. Condition that restates itself

```ts
// Before
if (isReady === true) { ... }
if (items.length > 0 ? true : false) { ... }
if (user && user !== null && user !== undefined) { ... }
```

```ts
// After
if (isReady) { ... }
if (items.length > 0) { ... }
if (user) { ... }
```

**Smell:** `=== true`, `? true : false`, and triple-guarding the same value.

### 3. Nested ternary pyramid

```ts
// Before — a === b ? b !== a ? c !== a && c !== b ? ...
const label =
  status === "live" ? "Live"
  : status === "cold" ? "Cold"
  : status === "archived" ? "Archived"
  : "Unknown";
```

```ts
// After — table lookup names each case
const STATUS_LABELS: Record<Status, string> = { live: "Live", cold: "Cold", archived: "Archived" };
const label = STATUS_LABELS[status] ?? "Unknown";
```

**Smell:** any ternary nested past one level. Map it, or use guard returns. `[lint: no-nested-ternary]`

### 11. Boolean flag parameters that fork the function

```ts
// Before
render(true);            // what is true?
save(data, false, true); // positional mystery meat
```

```ts
// After — split, or name the intent
renderInteractive();
save(data, { overwrite: false, backup: true });
```

**Smell:** boolean positional args. Split into two functions or pass a named options object.

### 13. Redundant `async`/Promise wrapping

```ts
// Before
const load = async (id: string) => { return await get(id); };
const ready = () => new Promise((res) => res(true));
```

```ts
// After
const load = (id: string): Promise<Row> => get(id);
const ready = (): Promise<boolean> => Promise.resolve(true);
```

**Smell:** `async` + `return await` with no try/catch; `new Promise` around an already-resolved value.

---

## Family 4 — Shape noise

### 5. Pointless from→to remap

```ts
// Before — copies every field to an identical shape
const dto = {
  id: row.id, provider: row.provider, title: row.title,
  slug: row.slug, sizeBytes: row.sizeBytes, status: row.status,
}; // same shape as `row`
```

```ts
// After — pass it through, or remap only what changes
return row; // or: { ...row, sizeBytes: convertBytesToMegabytes(row.sizeBytes) }
```

**Smell:** a mapping object whose keys/values equal the source.

### 7. Grab-bag object return (too many fields, or too few)

```ts
// Before — returns everything "just in case"
return { session, path, dir, base, ext, exists, stat, raw, parsed, parsedAt, isValid, errors, warnings, debug, _internal };
```

```ts
// After — return the concept the caller needs
return { session, sizeBytes, status };
```

**Smell:** callers use 2 of 15 fields — or the opposite, a bare tuple/boolean where a named result was needed.

### 18. Intermediate variable soup

```ts
// Before
const data = read(path);
const result = data.map(transform);
const temp = result.filter(Boolean);
const final = temp[0];
```

```ts
// After — name by concept, drop the throwaways
const [firstSession] = read(path).map(transform).filter(Boolean);
```

**Smell:** `data` / `result` / `temp` / `final` ladders.

---

## Family 5 — Dead space

### 8. No breathing room / wall-of-code body

```ts
// Before — no blank lines separating phases; multiple statements per line
const packSession = (s) => {
  const path = resolve(s); const meta = read(path); const archive = compress(meta);
  const hash = sha256(archive); writeManifest(hash); remove(path); return hash;
};
```

```ts
// After — blank lines group read / transform / commit phases
const packSession = (session: Session): string => {
  const path = resolve(session);
  const meta = read(path);

  const archive = compress(meta);
  const hash = sha256(archive);

  writeManifest(hash);
  remove(path);

  return hash;
};
```

**Smell:** statements crammed together with no grouping; several statements on one line. A function body should breathe: a blank line between its load / transform / commit phases.

### 15. Comments that restate the code

```ts
// Before
// increment count by one
count += 1;
// loop over sessions
for (const s of sessions) { ... }
```

```ts
// After — delete the noise; comment only the non-obvious "why"
count += 1;
for (const session of sessions) { ... }
```

**Smell:** narration comments. Keep comments for intent and gotchas, not restatement.

### 19. One function doing several jobs

```ts
// Before — parse + validate + fetch + render + log in one function
async function handle(req) {
  const body = JSON.parse(req.body);
  if (!body.id) throw new Error("bad");
  const user = await db.query(body.id);
  console.log("fetched", user);
  return `<div>${user.name}</div>`;
}
```

```ts
// After — one job each; compose at the edge
const parseRequest = (req: Req): UserQuery => UserQuerySchema.parse(req.body);
const loadUser = (q: UserQuery): Effect.Effect<User, DbError> => db.query(q.id);
const renderUser = (u: User): string => `<div>${u.name}</div>`;
```

**Smell:** a function whose name needs "and" to describe it. Split by job; compose. This is also the seam where **breathing room** (#8) matters most — each job is its own paragraph.
