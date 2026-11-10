/** `agent-setup doctor` — read-only health check for global and project scopes. */

import { Command } from "@effect/cli";
import { Effect } from "effect";

import { destinationForScope, scanHost } from "../config/host-scan.js";
import { checkHealth, type Discrepancy, type HealthReport } from "../doctor/doctor.js";
import { preparePackage } from "../install/prepare-package.js";
import { formatOption } from "./cli-options.js";
import * as TerminalUI from "./terminal-ui.js";

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
  const host = yield* Effect.tryPromise({ try: () => scanHost(), catch: (error) => error });
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
    yield* Effect.tryPromise({ try: () => TerminalUI.step(`${scope} scope`), catch: (error) => error });
    yield* Effect.tryPromise({
      try: () => TerminalUI.detail(installationLine(report.installation)),
      catch: (error) => error,
    });
    yield* Effect.tryPromise({
      try: () => TerminalUI.detail(report.config._tag === "present" ? "config: present" : "config: missing"),
      catch: (error) => error,
    });
    yield* Effect.tryPromise({ try: () => TerminalUI.detail(agentsLine(report.agents)), catch: (error) => error });
    for (const discrepancy of report.discrepancies) {
      yield* Effect.tryPromise({
        try: () => TerminalUI.warn(describeDiscrepancy(discrepancy)),
        catch: (error) => error,
      });
    }
  });

export const doctorCommand = Command.make("doctor", { format: formatOption }, (args) =>
  Effect.gen(function* () {
    if (args.format === "text")
      yield* Effect.tryPromise({ try: () => TerminalUI.intro("doctor"), catch: (error) => error });
    const scopes = yield* checkBothScopes;
    const unhealthy = scopes.some((scopeHealth) => scopeHealth.report.discrepancies.length > 0);
    if (unhealthy) process.exitCode = 1;
    if (args.format === "json") {
      yield* Effect.tryPromise({
        try: () => TerminalUI.showDocument({ _tag: unhealthy ? "unhealthy" : "healthy", scopes }),
        catch: (error) => error,
      });
      return;
    }

    yield* Effect.forEach(scopes, showScopeHealth);
    yield* Effect.tryPromise({ try: () => TerminalUI.outro("Read-only check complete."), catch: (error) => error });
  }),
).pipe(Command.withDescription("Read-only health check across global + project scopes"));
