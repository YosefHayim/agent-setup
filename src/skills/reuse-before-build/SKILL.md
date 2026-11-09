---
name: reuse-before-build
description: Use when you are about to build a feature and want to check what already exists — code in the repo, platform features, or packages. It gives one answer — reuse, extend, use a package, or build only what is missing. Say "do we already have this", "reuse first", or "is there a package for this".
type: flow
---

# Reuse before build

Find the smallest trustworthy thing that already solves the job before adding another implementation. Reuse is a decision supported by evidence, not a reflex to add a dependency.

## Safety

- Start read-only. Do not install packages, copy licensed code, change architecture, or contact paid services while auditing.
- Prefer repository-owned and platform-native capabilities. External reuse must fit the license, runtime, security boundary, maintenance posture, and version constraints.
- Use current official documentation or primary source repositories for ecosystem claims. Mark uncertain or stale evidence instead of guessing.
- Do not send private source or business data to external search, package, or model services.

## Workflow

1. State the required behavior, inputs, outputs, constraints, and non-goals in repository language.
2. Search internal code by concept and behavior, not only filenames: symbols, exports, tests, stories, fixtures, generated assets, dependencies, history, sibling packages, and nearby repositories explicitly in scope.
3. Trace promising candidates through callers and tests. Record exact paths, what is reusable as-is, and the adaptation cost.
4. Check platform and framework primitives already available at the project's supported versions.
5. Only if an internal fit is absent, research a short external list from current primary sources. Compare API fit, activity, ownership, release cadence, license, official advisories, provenance, transitive-dependency exposure, dependency/bundle cost, runtime support, accessibility, and exit cost.
6. Rank the options: reuse directly, extend, wrap only where policy is owned, adopt dependency, or build the missing gap. Prefer the least new surface that satisfies the requirement.
7. Present one recommendation with rejected alternatives and concrete tradeoffs. Implement only when the user's request includes implementation.

Avoid shallow matches: similar names do not prove equivalent semantics. Avoid dependency enthusiasm: popularity does not prove compatibility or stewardship.

## Verification

The audit is complete only when it includes:

- search scope and exact queries or inspection methods;
- repository candidates with clickable paths or symbol names;
- current primary-source links for external claims;
- version, runtime, license, security, maintenance, and integration evidence;
- a clear reuse/build recommendation and the remaining gap;
- explicit unknowns and searches that produced no reliable result.

Never claim “nothing exists” without showing where and how the search was performed.
