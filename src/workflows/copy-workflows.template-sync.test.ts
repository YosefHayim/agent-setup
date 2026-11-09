// report-failure.yml ships twice: as agent-setup's own workflow and as the template `workflow scaffold` copies.
// ci.yml and publish.yml differ on purpose: the templates carry setup notes and placeholders the copying repo fills in.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("src/templates/workflows stay in sync with .github/workflows", () => {
  it.each(["report-failure.yml"])("%s is byte-identical in both locations", (name) => {
    const active = readFileSync(path.join(repoRoot, ".github", "workflows", name), "utf8");
    const template = readFileSync(path.join(repoRoot, "src", "templates", "workflows", name), "utf8");

    expect(template).toBe(active);
  });
});
