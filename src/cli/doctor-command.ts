import type { Command } from "commander";

import { readDestinationForScope, scanHost } from "#src/config/host-scan.js";
import { checkHealth, type Discrepancy, type HealthReport } from "#src/doctor/doctor.js";
import { preparePackage } from "#src/install/prepare-package.js";
import { createCommand, type FormatSettings, formatOption } from "./cli-options.js";
import * as TerminalUI from "./terminal-ui.js";

export type HealthStatus = "healthy" | "unhealthy";

interface ScopeHealth {
  readonly scope: HealthReport["scope"];
  readonly report: HealthReport;
}

const readInstallationLine = (installation: HealthReport["installation"]): string => {
  const isInstallationMissing = installation._tag !== "present";

  if (isInstallationMissing) return "installation: missing";

  return `installation v${installation.version}: ${installation.features.join(", ") || "(no features)"}`;
};

const readAgentLabel = (agent: HealthReport["agents"][number]): string => {
  const isAgentManaged = agent.managed;
  const managedMark = isAgentManaged ? "*" : "";

  return `${agent.displayName}${managedMark} [idle hooks: ${agent.nativeHookSupport}]`;
};

const readAgentsLine = (agents: HealthReport["agents"]): string => {
  const agentLabels = agents
    .filter((agent) => agent.detected || agent.managed)
    .map(readAgentLabel)
    .join(", ");

  return `agents: ${agentLabels || "none detected"}`;
};

export const checkBothScopes = async (): Promise<ReadonlyArray<ScopeHealth>> => {
  const host = await scanHost();
  const preparedPackage = await preparePackage();
  const scopes = ["global", "project"] as const;

  return Promise.all(
    scopes.map(async (scope): Promise<ScopeHealth> => {
      const report = await checkHealth({
        destination: readDestinationForScope({ scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot }),
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
  const isSettingsPresent = report.config._tag === "present";
  await TerminalUI.runStep(`${scope} scope`);
  await TerminalUI.runDetail(readInstallationLine(report.installation));
  await TerminalUI.runDetail(isSettingsPresent ? "config: present" : "config: missing");
  await TerminalUI.runDetail(readAgentsLine(report.agents));

  for (const discrepancy of report.discrepancies) {
    await TerminalUI.warn(describeDiscrepancy(discrepancy));
  }
};

// The caller turns the status into the process exit code, so a found problem exits 1 after the report.
export const createDoctorCommand = (reportHealthStatus: (healthStatus: HealthStatus) => void): Command =>
  createCommand("doctor")
    .description("Read-only health check across global + project scopes")
    .addOption(formatOption)
    .action(async (settings: FormatSettings) => {
      const isPlainFormat = settings.format === "text";
      const isDocumentFormat = settings.format === "json";

      if (isPlainFormat) {
        await TerminalUI.runIntro("doctor");
      }

      const scopes = await checkBothScopes();
      const isUnhealthy = scopes.some((scopeHealth) => scopeHealth.report.discrepancies.length > 0);
      const healthStatus: HealthStatus = isUnhealthy ? "unhealthy" : "healthy";

      if (isDocumentFormat) {
        await TerminalUI.showDocument({ _tag: healthStatus, scopes });
      }

      if (isPlainFormat) {
        for (const scopeHealth of scopes) {
          await showScopeHealth(scopeHealth);
        }

        await TerminalUI.runOutro("Read-only check complete.");
      }

      reportHealthStatus(healthStatus);
    });
