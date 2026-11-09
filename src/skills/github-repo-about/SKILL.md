---
name: github-repo-about
description: Use when you want to write or check the GitHub "About" box of a repo — a one-line description, a website link, and topics. It follows GitHub's rules and shows before and after. Say "repo description", "GitHub topics", or "About section".
---

# GitHub repo About

Create concise GitHub repository metadata that helps visitors understand what
the project is, who it is for, and how to find related projects.

## Sources

Use these official sources when explaining or defending recommendations:

- GitHub profile/resume guide: repository details should include a brief
  project description, a website/demo link, and topic tags.
  <https://docs.github.com/en/account-and-profile/tutorials/using-your-github-profile-to-enhance-your-resume>
- GitHub README docs: the README owns the deeper explanation: what the project
  does, why it is useful, how users get started, where users get help, and who
  maintains it.
  <https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes>
- GitHub repository best practices: create a README for every repository.
  <https://docs.github.com/en/repositories/creating-and-managing-repositories/best-practices-for-repositories>
- GitHub topics docs: topics classify a repository by purpose, subject area,
  community, or language; use lowercase letters, numbers, and hyphens; keep each
  topic at 50 characters or less; add no more than 20 topics.
  <https://docs.github.com/articles/classifying-your-repository-with-topics>
- Open Source Guides: document status honestly, and update or mark stale docs.
  <https://opensource.guide/starting-a-project/>
  <https://opensource.guide/best-practices/>

## Workflow

1. Inspect before writing. Read the README, package metadata, primary source
   entry points, docs, and current GitHub metadata when available.
2. Draft one short description using this shape:

   ```text
   [Project type] for [specific user/use case] with [main capability or differentiator].
   ```

3. Draft topics, treating "tags" as GitHub topics. Prefer 6-12 high-signal
   topics over a full 20. Include purpose, domain, language/framework, runtime,
   and agent/tool ecosystem only when they are real signals.
4. Add a homepage/demo/docs URL only if it exists and helps someone inspect or
   use the project.
5. Show before/after before applying changes unless the user explicitly asked to
   apply immediately.

## Description Rules

- Specific beats generic: name the project type and job.
- Keep it one line; the README carries setup, architecture, and long context.
- Do not hype: avoid "awesome", "powerful", "best", "simple" unless the repo
  proves the claim.
- Do not overclaim production readiness. Put experimental, archived, internal,
  or not-production-ready status in the README.
- Match the repository contents. If the code and README disagree, say so and ask
  before publishing metadata.

## Topic Rules

- Use lowercase letters, numbers, and hyphens.
- Keep topics at 50 characters or less.
- Use no more than 20 topics.
- Avoid duplicates, vague tags, and private/internal terms that will not help
  discovery.
- Remember topic names are public, including on private repositories.

## Before/After Format

```md
Description
Before: My app
After: React Native app for tracking Olympic lifting workouts with offline history and progress charts.
Why: Names the app type, audience/use case, and differentiator in one line.

Topics
Before: app, react, project
After: react-native, expo, workout-tracker, olympic-weightlifting, offline-first, fitness
Why: Replaces vague tags with GitHub topics that describe purpose, stack, domain, and differentiator.
```

## Apply Changes

When the user asks to apply the metadata and GitHub CLI is available:

```bash
gh repo view --json description,homepageUrl,repositoryTopics,url
gh repo edit --description "TypeScript CLI for auditing GitHub repositories and generating maintenance reports." \
  --homepage "https://example.com/docs" \
  --add-topic typescript \
  --add-topic github \
  --add-topic repository-metadata
```

Use `--remove-topic <topic>` for stale topics. Do not change repository
visibility or merge settings while doing metadata work.
