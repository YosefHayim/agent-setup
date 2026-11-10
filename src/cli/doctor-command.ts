import type { Command } from "commander";

import { destinationForScope, scanHost } from "../config/host-scan.js";
import { checkHealth, type Discrepancy, type HealthReport } from "../doctor/doctor.js";
import { preparePackage } from "../install/prepare-package.js";
import { createCommand, type FormatOptions, formatOption } from "./cli-options.js";
import * as TerminalUI from "./terminal-ui.js";

export type HealthStatus = "healthy" | "unhealthy";

interface ScopeHealth {
  readonly scope: HealthReport["scope"];
  readonly report: HealthReport;
}

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

export const checkBothScopes = async (): Promise<ReadonlyArray<ScopeHealth>> => {
  const host = await scanHost();
  const preparedPackage = await preparePackage();
  const scopes = ["global", "project"] as const;

  return Promise.all(
    scopes.map(async (scope): Promise<ScopeHealth> => {
      const report = await checkHealth({
        destination: destinationForScope({ scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot }),
        preparedPackage,
        platform: host.platform,
        agentEvidence: host.agentEvidence,
      });
      return { scope, report };
    }),
  );
};

// A missing dependency names the command that adds it; every other discrepancy shows its tag.
const describeDiscrepancy = (discrepancy: Discrepancy): string => {
  const isOtherDiscrepancy = discrepancy._tag !== "missingFeatureDependency";
  if (isOtherDiscrepancy) {
    return discrepancy._tag;
  }

  return `missingFeatureDependency: ${discrepancy.featureId} is required but not recorded; run install or update to add it`;
};

// Reports every discrepancy without offering a repair.
export const showScopeHealth = async ({ scope, report }: ScopeHealth): Promise<void> => {
  const isConfigPresent = report.config._tag === "present";
  await TerminalUI.step(`${scope} scope`);
  await TerminalUI.detail(installationLine(report.installation));
  await TerminalUI.detail(isConfigPresent ? "config: present" : "config: missing");
  await TerminalUI.detail(agentsLine(report.agents));

  for (const discrepancy of report.discrepancies) {
    await TerminalUI.warn(describeDiscrepancy(discrepancy));
  }
};

// The caller turns the status into the process exit code, so a found problem exits 1 after the report.
export const createDoctorCommand = (reportHealthStatus: (healthStatus: HealthStatus) => void): Command =>
  createCommand("doctor")
    .description("Read-only health check across global + project scopes")
    .addOption(formatOption)
    .action(async (options: FormatOptions) => {
      const isTextFormat = options.format === "text";
      const isJsonFormat = options.format === "json";

      if (isTextFormat) {
        await TerminalUI.intro("doctor");
      }

      const scopes = await checkBothScopes();
      const isUnhealthy = scopes.some((scopeHealth) => scopeHealth.report.discrepancies.length > 0);
      const healthStatus: HealthStatus = isUnhealthy ? "unhealthy" : "healthy";
      if (isJsonFormat) {
        await TerminalUI.showDocument({ _tag: healthStatus, scopes });
      }

      if (isTextFormat) {
        for (const scopeHealth of scopes) {
          await showScopeHealth(scopeHealth);
        }

        await TerminalUI.outro("Read-only check complete.");
      }

      reportHealthStatus(healthStatus);
    });
