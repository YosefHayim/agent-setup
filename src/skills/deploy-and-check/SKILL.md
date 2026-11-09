---
name: deploy-and-check
description: Use when you want to deploy to production and prove it is live. It deploys (Cloudflare or other hosts) and tests the real production URL, not only your computer. Say "deploy", "redeploy", "is it live", or "prove production". To test on your computer, use run-local-and-check.
type: flow
---

# Deploy and check

Deployment has two identities: the intended source and the artifact actually serving users. Prove both, plus behavior, before calling a release live.

## Safety

- Confirm the deployment target, environment, provider, branch/tag policy, and user authorization before causing external state changes.
- Inspect current production state and release instructions first. Do not infer a version bump, create a tag, publish a package, migrate data, or promote to production when the request does not authorize it.
- Never expose provider tokens, environment values, customer data, or private logs. Use safe smoke inputs and read-only provider checks where possible.
- Preserve rollback capability. Stop on unclear database compatibility, destructive migrations, failed health gates, or a source/version mismatch.

## Workflow

1. Define “latest”: local HEAD, remote branch SHA, release tag, package version, image digest, deployment ID, or another immutable identity. Reconcile differences before deploying.
2. Read repository release docs and inspect branch cleanliness, upstream state, version, changelog, migration requirements, build inputs, and existing production identity.
3. Run narrow checks and the full repository verification gate from the exact source to deploy. Build the release artifact and record its digest, provenance, or package contents when supported.
4. Use the documented provider-native deployment path. Capture deployment/run ID, source SHA/tag, artifact version/digest, target environment, and timestamps.
5. Monitor the provider to a terminal state. Inspect build/runtime logs and health signals; a CLI command returning zero before rollout finishes is not success.
6. Read production back from an independent surface: provider API/dashboard, package registry, image registry, deployment metadata, or response headers/version endpoint.
7. Exercise a harmless real production smoke path that covers the changed behavior. For packages, perform a fresh isolated install and run the affected command; for web/API, use the public origin rather than a local server.
8. Compare intended and served identities. If they differ or behavior fails, stop the claim, preserve evidence, and follow the documented rollback or recovery path within authorization.

## Verification

Report:

- intended source SHA, tag/version, and clean/dirty state;
- fresh verification and artifact build results;
- provider deployment/run ID and terminal status;
- registry, provider, or live-runtime identity readback;
- smoke-test command or flow and observed behavior;
- logs/health issues, propagation caveats, and rollback readiness;
- exact production URL or package coordinate when safe.

Do not equate a pushed commit, merged PR, created tag, successful build, registry metadata, or provider “started” state with a proven live deployment.
