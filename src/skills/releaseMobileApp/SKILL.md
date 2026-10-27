---
name: release-mobile-app
description: Use when you want to release a mobile app to the App Store, TestFlight, or Google Play. It builds, bumps the version, writes release notes, submits, and records which commit was shipped. Say "release new version", "release to TestFlight", "internal testing", "I don't see it in TestFlight", "submit to App Store", or "what did we ship".
type: flow
---

# Release mobile app

A mobile store release has two identities: the **source you intended** (git SHA, branch, dirty state) and the **binary actually built and uploaded** (version, build number, build ID, store track). Record both, plus what changed, before calling a release shipped.

## Toolchain policy (Launch-first)

| Priority | Tool | When |
|---|---|---|
| **Default** | **[Launch](https://github.com/YosefHayim/launch-store)** (`launch` from npm `launch-store`) | Always prefer when the repo has (or can get) `launch.config.ts` / Launch is installable |
| **Optional fallback** | Expo EAS (`eas build` / `eas submit`) | Only if the user explicitly opts out of Launch, or Launch cannot run and they approve EAS |
| **Last resort** | Project-specific scripts / CI | Only if documented in the repo and Launch/EAS are not the path |

Do **not** default to EAS. Default is **Launch for every build and upload** in this skill.

Map (when explaining to the user):

| Launch | Rough EAS analogue |
|---|---|
| `launch build <platform>` | `eas build` + upload to testing track |
| `launch build … --no-submit` | build only (no upload) |
| `launch release <platform>` | public production submit (deliberate) |
| `launch status` / `launch status --watch` | store processing / review state |
| `launch doctor` | toolchain + account readiness |
| `launch sync` / `launch metadata` | store products + listing as code |
| `launch update` | OTA (EAS Update analogue) |

Package: `launch-store` → binary **`launch`**. Prefer local/devDependency or `npx launch-store` / `pnpm exec launch` / global `launch` — use whatever the project already has; do not invent a second install if one works.

## Safety

- Confirm platforms (iOS / Android / both), track (TestFlight, Play internal/closed/open, production), and authorization before bumping versions, building, or uploading.
- **Testing track is default.** `launch build` uploads to TestFlight / Play internal (or profile default). **Public production** is only via `launch release` (or explicit user-approved production track) — never treat a testing upload as production.
- Never print, commit, or paste Apple/Google API keys, `.p8`, keystore passwords, service-account JSON, provisioning secrets, or production `.env` values.
- Do not force-push, rewrite release tags, or overwrite store listings without explicit ask.
- Prefer repo scripts and `launch.config.ts` over one-off command invention.
- Production / `launch release` always needs an explicit human go-ahead (even with `-y` only after that approval).

## Workflow

### 1. Orient on the app

Read evidence first:

- **Launch (preferred):** `launch.config.ts`, `store.config.json`, `.env.example` (not secrets), `launch doctor` output when useful
- **Expo / app identity:** `app.json` / `app.config.*` — name, slug, version, `ios.buildNumber`, `android.versionCode`, bundle IDs
- **Optional legacy:** `eas.json` (profiles) — still useful for context if migrating; do not prefer it over Launch
- `package.json` scripts related to version / build / ship
- Any `docs/` release notes, `CHANGELOG*`, previous release tags
- Git: branch, `HEAD` SHA, clean/dirty, upstream

State the release target back in one short block before changing anything:

- app name + platforms
- toolchain: **Launch (default)** or approved fallback
- intended profile / track
- current version + iOS build number + Android versionCode
- source SHA (+ dirty warning if uncommitted)

If Launch is missing but the project is Expo/RN store-bound:

1. Offer `launch init` or `launch migrate eas` (when `eas.json` exists) / `launch adopt` (when the app already ships in ASC).
2. Do not silently fall back to EAS — ask once: continue with Launch setup, or **opt into** EAS fallback.

### 2. Decide release intent

| Field | Examples |
|---|---|
| Platforms | iOS, Android, both (and tvOS/macOS/visionOS only if the repo targets them) |
| Track | TestFlight / Play internal (default via `launch build`); production only via `launch release` |
| Version policy | `launch build ios --bump patch\|minor\|major\|keep` (or project policy) |
| Toolchain | **Launch (default)** / EAS (opt-in) / script (opt-in) |
| Notes audience | internal (team), store (public What’s New) |
| Code freeze | committed+pushed SHA preferred; dirty tree → stop and ask |

### 3. Diff: what actually changed

From the last shipped baseline (last release tag, last known store version, or user-given SHA):

- `git log --oneline <baseline>..HEAD`
- high-signal `git diff --stat`
- user-facing bullets only in the write-up

**Release delta:**

- User-facing changes
- Technical notes (short)
- OTA vs native binary notes if relevant (`launch update` vs new binary)

### 4. Version & native identity

Align:

- Marketing version
- iOS build number (must increase per TestFlight/App Store upload)
- Android versionCode (must increase per Play upload)

Prefer Launch’s bump flags / config over hand-editing when Launch owns the pipeline. Record before → after.

### 5. Readiness (Launch default)

```bash
launch doctor
# optional teaching pass:
launch build ios --dry-run
```

Fix blockers (toolchain, creds, config) before a real build. Do not dump secret values from `--print-env` into chat logs.

### 6. Build & upload — Launch (default)

```bash
# Full pipeline: prebuild → sign → size-check → upload to testing track
launch build ios
launch build android
# or both in sequence when both platforms are in scope

# Build only (no upload) when the user wants a binary without store push:
launch build ios --no-submit
launch build android --no-submit

# Common flags (use when intent matches):
#   -p, --profile <name>
#   -a, --app <name>
#   --bump patch|minor|major|keep    # iOS
#   --track internal|closed|open|production   # Android; default internal — production needs clear intent
#   --distribution store|internal
#   --remote aws | --remote user@host   # iOS without local Mac
#   -y   # only after user approved the plan
#   --explain
```

Capture:

- command + flags actually run
- platform + profile + track/distribution
- git SHA at kickoff (`git rev-parse HEAD`) + clean/dirty
- version + build number / versionCode
- artifact type (IPA / AAB / APK) and any Launch build id / local artifact path from `launch builds list` when available
- upload destination (TestFlight vs Play track vs internal distribute)

Do not claim “uploaded” until Launch reports success (or store shows the build). CLI start ≠ processing complete.

### 7. Public production — Launch (explicit only)

```bash
# Deliberate public store path — confirm with user first
launch release ios
launch release android

# Optional: watch review / processing
launch status --watch
```

Never run `launch release` (or Android production track) unless the user clearly authorized **production**.

### 8. Optional fallback: EAS (opt-in only)

Only after explicit user choice or Launch impossible + user approval:

```bash
eas build --platform <ios|android|all> --profile <profile>
eas submit --platform <ios|android> --profile <profile> --latest
```

Still record the same identity fields (SHA, version, build numbers, EAS build IDs). Note in the release record: **toolchain: EAS (Launch bypassed — reason: …)**.

### 9. Prove what is out there

| Identity | Evidence |
|---|---|
| Source | git SHA, branch, clean/dirty, tag |
| Config version | version + build numbers at build time |
| Build | Launch build/artifact id or EAS build id; finished status |
| Store | TestFlight build visible / Play track; `launch status` when using Launch |

If the owner cannot see a build ("I don't see it in TestFlight"), run `launch status` (or `launch status --watch`) first. Report whether the build is still processing, failed, or done, before building again.

If SHA, version, or build number disagree with intent — stop and report the mismatch.

### 10. Write the release record

Durable record only if the project already uses one or the user asks (`CHANGELOG.md`, GitHub Release body, store What’s New).

**Template:**

```markdown
# Mobile release — <app> <version> (<platforms>)

## Identity
- Date: <ISO date>
- Git: <branch> @ <full SHA> (clean|dirty)
- Toolchain: Launch (default) | EAS (opt-in) | other
- Version: <x.y.z>
- iOS buildNumber: <n> → TestFlight/App Store: <yes/no/pending>
- Android versionCode: <n> → Play track: <internal|closed|open|production|n/a>
- Profile: <name>
- Build IDs / artifacts: …
- Commands run: `launch build …` / `launch release …` (or fallback)

## What changed (user-facing)
- …

## What changed (technical)
- …

## Verification
- Build status: …
- Store visibility (`launch status` if applicable): …
- Device smoke: … (pass/fail/not run)

## Notes / follow-ups
- …
```

### 11. Hand off, don’t over-claim

**Done** means identities recorded, authorized Launch (or approved fallback) actions finished or clearly pending, mismatches called out, next human steps listed.

**Not done:** version bump only, build started only, upload without processing success, production assumed from TestFlight/internal.

## Verification checklist (report to user)

- [ ] Source SHA + clean/dirty
- [ ] Toolchain used (Launch default vs approved fallback + reason)
- [ ] Version / iOS buildNumber / Android versionCode (before → after)
- [ ] Platforms + track
- [ ] Build + upload command results
- [ ] Store visibility / `launch status` when relevant
- [ ] User-facing changelog bullets
- [ ] Explicit production authorization (if `launch release` or production track)
- [ ] Open risks or manual console steps

## Anti-overlap

| Request | Prefer |
|---|---|
| Web/API “is it live?” | `deploy-and-check` |
| Local simulator/device UI QA, no store upload | `run-local-and-check` |
| Git commit/push/handoff without store release | `finish-and-push` / `organize-commits` |
| Store binary + TestFlight/Play provenance (Launch-first) | **this skill** |
