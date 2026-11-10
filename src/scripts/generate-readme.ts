import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type FeatureDefinition, featureCatalog } from "#src/catalog/feature-catalog.js";
import { defaultConfig, settingList } from "#src/config/config-schema.js";
import { environmentVariables } from "#src/config/environment-variables.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const README_PATH = path.join(ROOT, "README.md");
const SKILLS_ROOT = path.join(ROOT, "src/skills");

type CommunitySkill = { author: string; url: string; upstreamNames: ReadonlyArray<string> };

// Skills bundled for convenience but written by others: credited in their own table, left out of the owned one.
const COMMUNITY_SKILLS: ReadonlyMap<string, CommunitySkill> = new Map([
  [
    "make-code-readable",
    { author: "Mike Cann", url: "https://github.com/mikecann/agent-skills", upstreamNames: ["deslop"] },
  ],
  [
    "question-my-plan",
    {
      author: "Matt Pocock",
      url: "https://github.com/mattpocock/skills",
      upstreamNames: ["grill-me", "grill-with-docs"],
    },
  ],
]);

const PLATFORM_LABELS: Record<FeatureDefinition["platform"], string> = {
  any: "🟢 any OS",
  macos: "🟡 macOS",
};

// Keep table cells on one line.
const readTableCell = (cell: string): string => cell.replaceAll("|", "\\|").replaceAll("\n", " ");

// Only single-line top-level values are needed, so this is not a YAML parser.
const readFrontmatterField = (skill: string, key: string): string => {
  const frontmatterBlock = /^---\n([\s\S]*?)\n---/u.exec(skill)?.[1] ?? "";
  const frontmatterLine = frontmatterBlock.split("\n").find((candidate) => candidate.startsWith(`${key}:`));
  return (frontmatterLine ?? "")
    .slice(key.length + 1)
    .trim()
    .replace(/^["']|["']$/gu, "");
};

const readSkillDescriptions = (): ReadonlyMap<string, string> =>
  new Map(
    readdirSync(SKILLS_ROOT)
      .map((directory) => path.join(SKILLS_ROOT, directory, "SKILL.md"))
      .filter((file) => existsSync(file))
      .flatMap((file) => {
        const skill = readFileSync(file, "utf8");

        const description = readFrontmatterField(skill, "description");

        const isDescriptionMissing = !description;
        if (isDescriptionMissing) {
          console.warn(`⚠️  Skipping ${file}: no description`);
          return [];
        }

        return [[readFrontmatterField(skill, "name") || path.basename(path.dirname(file)), description] as const];
      }),
  );

const readFeaturesTable = (): string =>
  [
    "| Feature | What it does | Runs on |",
    "| --- | --- | --- |",
    ...featureCatalog
      .filter((feature) => !COMMUNITY_SKILLS.has(feature.id))
      .map(
        (feature) => `| **${feature.id}** | ${readTableCell(feature.summary)} | ${PLATFORM_LABELS[feature.platform]} |`,
      ),
  ].join("\n");

const readCommunitySection = (descriptions: ReadonlyMap<string, string>): string =>
  [
    "These skills ship with agent-setup for convenience — installable the same way (`pnpm tsx --conditions=source src/cli/main.ts install <id>`) — but they are **authored by others**, not by agent-setup. Full credit and upstream sources:",
    "",
    "| Skill | What it does | By |",
    "| --- | --- | --- |",
    ...[...COMMUNITY_SKILLS].flatMap(([id, credit]) => {
      const description = descriptions.get(id);
      const upstreamNames = credit.upstreamNames.map((name) => `\`${name}\``).join(", ");
      const isSkillDescribed = description != null;

      if (!isSkillDescribed) return [];

      return [`| **${id}** | ${description} | [${credit.author}](${credit.url}) (upstream: ${upstreamNames}) |`];
    }),
    "",
    "> `code-style` is an agent-setup-original skill that builds on Matt Pocock's grilling pattern — it stays in the owned catalog above.",
  ].join("\n");

const readDefaultString = (defaultSetting: unknown): string => {
  const isDefaultAbsent = typeof defaultSetting === "undefined";

  if (isDefaultAbsent) return "absent";

  return `\`${JSON.stringify(defaultSetting)}\``;
};

const readSettingsSection = (): string =>
  [
    "agent-setup keeps one `config.json` in its install root: `~/.claude/agent-setup/config.json` for a global install, `.claude/agent-setup/config.json` for a project install. Change a setting with `agent-setup config set <setting> <value>`, show it with `agent-setup config show`, and reset it with `agent-setup config reset`. A file with an unknown key does not load; fix it or run `agent-setup config reset`.",
    "",
    "| Setting | config.json key | Default | What it does |",
    "| --- | --- | --- | --- |",
    ...settingList.map(
      (setting) =>
        `| \`${setting.name}\` | \`${setting.key}\` | ${readDefaultString(defaultConfig[setting.key])} | ${readTableCell(setting.description)} |`,
    ),
    "",
    "### Environment variables",
    "",
    "| Variable | Default | What it does |",
    "| --- | --- | --- |",
    ...environmentVariables.map(
      (variable) =>
        `| \`${variable.name}\` | ${readTableCell(variable.defaultValue)} | ${readTableCell(variable.purpose)} |`,
    ),
  ].join("\n");

const replaceSection = (readme: string, section: { marker: string; content: string }): string => {
  const start = `<!-- AUTO:${section.marker}:START -->`;
  const end = `<!-- AUTO:${section.marker}:END -->`;
  const startIndex = readme.indexOf(start);

  const endIndex = readme.indexOf(end);

  const isMarkerMissing = startIndex === -1 || endIndex === -1;
  if (isMarkerMissing) {
    throw new Error(`Markers not found: ${start} / ${end}. Add them to README.md and re-run.`);
  }

  return `${readme.slice(0, startIndex + start.length)}\n${section.content}\n${readme.slice(endIndex)}`;
};

const descriptions = readSkillDescriptions();
console.log(`Found ${featureCatalog.length} features, ${descriptions.size} skills, ${settingList.length} settings`);

const currentReadme = readFileSync(README_PATH, "utf8");
const renderedReadme = [
  { marker: "FEATURES", content: readFeaturesTable() },
  { marker: "SKILLS", content: readCommunitySection(descriptions) },
  { marker: "SETTINGS", content: readSettingsSection() },
].reduce(replaceSection, currentReadme);

const isWriteRequested = !process.argv.includes("--check");

if (isWriteRequested) {
  writeFileSync(README_PATH, renderedReadme);
  console.log("✅ README.md updated");
}

const isCheckRequested = !isWriteRequested;
const isReadmeStale = renderedReadme !== currentReadme;

const isStaleCheckFailed = isCheckRequested && isReadmeStale;
if (isStaleCheckFailed) {
  throw new Error("README.md is stale. Run `pnpm readme:generate`.");
}

if (isCheckRequested) {
  console.log("README.md matches its sources");
}
