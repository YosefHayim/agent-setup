/** `agent-setup doctor` — read-only health check for global and project scopes. */

import { Command } from "@effect/cli";
import { Effect } from "effect";

import { destinationForScope, scanHost } from "../config/hostScan.js";
import { checkHealth, type Discrepancy, type HealthReport } from "../doctor/doctor.js";
import { preparePackage } from "../install/preparePackage.js";
import { formatOption } from "./cliOptions.js";
import * as TerminalUI from "./TerminalUI.js";

type ScopeHealth = { readonly scope: HealthReport["scope"]; readonly report: HealthReport };

const installationLine = (installation: HealthReport["installation"]): string =>
  installation._tag === "present"
    ? `installation v${installation.version}: ${installation.features.join(", ") || "(no features)"}`
    : "installation: missing";

const agentsLine = (agents: HealthReport["agents"]): string =>
  `agents: ${
    agents
      .filter((agent) => agent.detected || agent.managed)
      .map((agent) => `${agent.displayName}${agent.managed ? "*" : ""} [idle hooks: ${agent.nativeHookSupport}]`)
      .join(", ") || "none detected"
  }`;

export const checkBothScopes = Effect.gen(function* () {
  const host = yield* scanHost;
  const preparedPackage = yield* preparePackage;
  return yield* Effect.forEach(["global", "project"] as const, (scope) =>
    checkHealth({
      destination: destinationForScope({ scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot }),
      preparedPackage,
      platform: host.platform,
      agentEvidence: host.agentEvidence,
    }).pipe(Effect.map((report): ScopeHealth => ({ scope, report }))),
  );
});

// A missing dependency names the command that adds it; every other discrepancy shows its tag.
const describeDiscrepancy = (discrepancy: Discrepancy) => {
  const isMissingDependency = discrepancy._tag === "missingFeatureDependency";
  if (!isMissingDependency) return discrepancy._tag;

  return `missingFeatureDependency: ${discrepancy.featureId} is required but not recorded; run install or update to add it`;
};

// Reports every discrepancy without offering a repair.
export const showScopeHealth = ({ scope, report }: ScopeHealth) =>
  Effect.gen(function* () {
    yield* TerminalUI.step(`${scope} scope`);
    yield* TerminalUI.detail(installationLine(report.installation));
    yield* TerminalUI.detail(report.config._tag === "present" ? "config: present" : "config: missing");
    yield* TerminalUI.detail(agentsLine(report.agents));
    for (const discrepancy of report.discrepancies) {
      yield* TerminalUI.warn(describeDiscrepancy(discrepancy));
    }
  });

export const doctorCommand = Command.make("doctor", { format: formatOption }, (args) =>
  Effect.gen(function* () {
    if (args.format === "text") yield* TerminalUI.intro("doctor");
    const scopes = yield* checkBothScopes;
    const unhealthy = scopes.some((scopeHealth) => scopeHealth.report.discrepancies.length > 0);
    if (unhealthy) process.exitCode = 1;
    if (args.format === "json") {
      yield* TerminalUI.json({ _tag: unhealthy ? "unhealthy" : "healthy", scopes });
      return;
    }

    yield* Effect.forEach(scopes, showScopeHealth);
    yield* TerminalUI.outro("Read-only check complete.");
  }),
).pipe(Command.withDescription("Read-only health check across global + project scopes"));
