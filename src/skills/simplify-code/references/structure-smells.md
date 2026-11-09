# Structural over-engineering smells

Over-engineering is not only per-line. Folders, files, layers, and packages are abstractions too, and the **same one test** applies: a folder earns its place with 3+ real files or a genuine sub-domain; a package earns its place with a real consumer boundary; a layer earns its place when a second implementation actually exists. Otherwise flatten it.

`ls`/tree the target before judging, and map imports before moving anything shared.

---

## S1 — Deep nesting for a handful of files

```txt
Before                                    After
src/app/modules/user/domain/              src/user/
  entities/User.ts        (1 type)          user.ts       (type + fns + schema)
  repositories/UserRepo.ts(1 fn)            userStore.ts
  services/UserService.ts (1 fn)
```

**Smell:** six folders deep to hold three tiny files. Flatten until each folder holds real weight.

---

## S2 — One-export-per-file explosion + barrel

```txt
Before                          After
utils/                          text.ts
  slugify.ts   (1 line)           export const slugifyTitle = ...
  truncate.ts  (1 line)           export const truncate = ...
  capitalize.ts(1 line)           export const capitalize = ...
  index.ts     (re-exports 3)
```

**Smell:** every one-liner gets its own file plus a barrel to glue them back. Group cohesive helpers in one named module.

---

## S3 — Layer-first folders for a tiny app (pattern, not domain)

```txt
Before — split by technical role            After — split by domain
src/                                         src/
  controllers/  packController.ts              pack/     (command + logic + types)
  services/     packService.ts                 scan/
  repositories/ packRepo.ts                    providers/
  factories/    packFactory.ts
  interfaces/   IPackService.ts
```

**Smell:** `controllers/services/repositories/factories/interfaces/` mirrors a framework tutorial, not this codebase. One feature's code is scattered across five sibling trees. Prefer feature/domain folders where a single change lives in one place.

---

## S4 — Single-implementation interface abstraction

```txt
Before                          After
providers/                      providers/
  IProvider.ts   (interface)      codex.ts   (the adapter object, typed inline)
  BaseProvider.ts(abstract)
  impl/CodexProvider.ts (only 1)
```

**Smell:** interface + abstract base + one concrete class. Ship the one thing; add the interface when a second implementation actually appears.

---

## S5 — Dumping-ground folders

```txt
Before            After
src/utils/        (delete — move each fn to the module that owns the concept)
src/helpers/
src/common/
src/misc/
```

**Smell:** `utils/helpers/common/misc`. A folder named after "stuff I couldn't place" owns no concept. Give each function a home in the module that uses it.

---

## S6 — Package/module-itis (over-modularization)

```txt
Before — a "package" per trivial thing       After
packages/                                     src/
  slugify/  (package.json, 1 fn)                text.ts
  logger/   (package.json, wraps console)       log.ts
  types/    (package.json, 3 types)             types.ts
```

**Smell:** monorepo/package boundaries around things that are one file. A package boundary costs a manifest, a build edge, a version, and a publish step — earn it with a real independent consumer.

---

## S7 — The opposite extreme: the god-file that should split

Over-engineering has a mirror twin — **under-structuring**. A single file that owns unrelated concerns is as hard to navigate as fifty one-liners.

```txt
Before                                  After
src/                                    src/
  everything.ts  (1,800 lines:            pack/packSession.ts
    pack + scan + restore + index          scan/scanStore.ts
    + CLI parsing + rendering)             restore/restoreSession.ts
                                           cli/main.ts
                                           output/render.ts
```

**Smell:** one file crossing several domains (pack vs scan vs restore vs CLI vs output). Split along the domain seams — but stop there. Do not swing back to S1/S2 and shatter it into one-function files.

---

## Calibration — the middle is the target

S1–S6 are "too much structure"; S7 is "too little". The right answer is almost always the **middle**: folders and files that match the number and shape of real concepts. When in doubt, count the concepts, not the lines — one folder per real sub-domain, one file per cohesive unit, one package per real consumer boundary.
