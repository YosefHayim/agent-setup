---
name: install-skills
description: Use when you want to install, update, or sync skills for all your coding agents, for your whole computer or for one project. It checks that each agent can really find the skills. Say "install skills", "sync skills", or "update skills everywhere".
type: flow
disable-model-invocation: true
---

# Install skills

Synchronize from canonical skill source through each agent's supported native format. Folder existence is not proof that a running agent can discover a skill.

## Safety

- Identify the canonical source and its revision before touching provider projections. Never edit generated installed copies as source.
- Prefer a receipt-backed installer such as agent-setup. Preserve the existing selected feature set and make additions explicit; do not replace the user's installed features with only the newly named skills.
- Detect providers from the installer's catalog and live evidence. Never invent a dot-directory or claim support for an uncataloged agent such as Grok without an official, verified integration surface.
- Plan before apply. Preserve non-owned provider instructions and config byte-for-byte; only the receipt authorizes updates or deletion.
- Do not expose tokens or modify unrelated agent, MCP, model, or permission settings.

## Workflow

1. Inspect repository instructions, canonical skill directories, catalog entries, shipped-path allowlists, current revision, dirty state, and existing global or project receipt.
2. Validate every requested skill before installation: frontmatter name/description, referenced assets, source/catalog identity, and exact shipped paths.
3. Detect installed agents with the repository's supported evidence model. Produce a matrix of provider ID, detection evidence, native target format, destination, and support status.
4. Determine desired state by preserving receipt features and adding or refreshing the requested skills. Resolve catalog dependencies before applying.
5. Build and verify canonical source. Use the repository CLI non-interactively with the requested scope and detected-agent selection; avoid manual copies except for diagnosis.
6. Inspect the resulting receipt and provider-native artifacts. Compare directory targets byte-for-byte and rule/instruction/instruction-link targets semantically after format projection.
7. Run the installer's doctor. Then perform provider-level discovery smoke checks when the CLI or application exposes them; note when restart or a fresh session is required.
8. Report unsupported, undetected, skipped, installed, and failed providers separately. Give an exact follow-up for providers that require an official adapter.

For agent-setup, inspect `agent-setup install --help` or the repository CLI rather than relying on remembered flags. Global synchronization must use the built source requested by the user, especially before a package release.

## Verification

Record:

- canonical source path, commit SHA, dirty state, and package/build identity;
- preserved versus added feature IDs;
- provider detection matrix and native target formats;
- install command outcome and resulting receipt scope;
- source-to-destination asset or semantic parity checks;
- doctor results and provider discovery smoke checks;
- restart requirements and unsupported providers.

Do not say “synced everywhere” when a provider was not detected, lacks catalog support, only received a guessed copy, or has not reloaded the new skill metadata.
