/** The install capability request, its summary, and its failure. */

import { Schema } from "effect";

import { agentEvidenceSchema, agentIdSchema } from "../catalog/agent-catalog.js";
import { featureIdSchema, featurePlatformSchema } from "../catalog/feature-catalog.js";
import { configSchema } from "../config/config-schema.js";
import { installationLocationSchema } from "./install-paths.js";
import { absoluteRootSchema } from "./plan.js";
import { versionSchema } from "./receipt.js";

export const selectedFeatureChoiceSchema = Schema.TaggedStruct("selected", {
  ids: Schema.Array(featureIdSchema).annotations({
    description: "Explicit public feature IDs expanded through catalog dependencies.",
  }),
});

const featureChoiceSchema = Schema.Union(
  Schema.TaggedStruct("defaults", {}).annotations({
    description: "Catalog features selected by default.",
  }),
  selectedFeatureChoiceSchema,
).annotations({
  description: "Default or explicit feature selection without behavior flags.",
});

const selectedAgentChoiceSchema = Schema.TaggedStruct("selected", {
  ids: Schema.Array(agentIdSchema).annotations({
    description: "Explicit public agent IDs receiving native files.",
  }),
});

export const agentChoiceSchema = Schema.Union(
  selectedAgentChoiceSchema,
  Schema.TaggedStruct("detected", {
    evidence: agentEvidenceSchema.annotations({
      description: "Observed evidence the decoded agent catalog uses to detect installed agents.",
    }),
  }),
).annotations({
  description: "Explicit or evidence-derived agent selection.",
});

export const interactionSchema = Schema.Union(
  Schema.TaggedStruct("interactive", {}),
  Schema.TaggedStruct("scripted", {}),
).annotations({
  description: "Caller interaction mode retained for presentation at the CLI edge.",
});

export const configurationChoiceSchema = Schema.Union(
  Schema.TaggedStruct("automatic", {}).annotations({
    description: "Reuse this scope's config, inherit once for a project, or use schema defaults.",
  }),
  Schema.TaggedStruct("selected", {
    config: configSchema.annotations({
      description: "Complete validated configuration explicitly selected by the caller.",
    }),
  }),
  Schema.TaggedStruct("reset", {}).annotations({
    description: "Replace the managed config with schema defaults whatever the current file holds.",
  }),
).annotations({
  description: "Automatic, explicit, or reset complete configuration selection.",
});

export const preparedPackageSchema = Schema.Struct({
  root: absoluteRootSchema.annotations({
    description: "Absolute prepared dist root containing only verified skills and runtime files.",
  }),
  version: versionSchema.annotations({
    description: "Semantic package version published in the ownership receipt.",
  }),
}).annotations({
  description: "Verified prepared package consumed by installation.",
});

export const installRequestSchema = Schema.extend(
  installationLocationSchema,
  Schema.Struct({
    preparedPackage: preparedPackageSchema,
    features: featureChoiceSchema,
    agents: agentChoiceSchema,
    interaction: interactionSchema,
    configuration: configurationChoiceSchema,
  }),
).annotations({
  description: "Complete install capability request decoded before filesystem inspection.",
});

export type InstallRequest = Schema.Schema.Type<typeof installRequestSchema>;

export const platformRequirementSchema = Schema.Struct({
  featureId: featureIdSchema.annotations({
    description: "Selected feature that declared this host requirement.",
  }),
  platform: featurePlatformSchema,
}).annotations({
  description: "Catalog-correlated host requirement surfaced without hidden environment probing.",
});

const installSummaryFieldsSchema = {
  scope: Schema.Literal("global", "project").annotations({
    description: "Scope synced by this capability call.",
  }),
  features: Schema.Array(featureIdSchema).annotations({
    description: "Dependency-resolved features in catalog order.",
  }),
  agents: Schema.Array(agentIdSchema).annotations({
    description: "Selected agents in catalog order.",
  }),
  platformRequirements: Schema.Array(platformRequirementSchema).annotations({
    description: "Platform requirement for every dependency-resolved selected feature.",
  }),
  interaction: interactionSchema,
};

const installSummarySchema = Schema.Union(
  Schema.TaggedStruct("installed", installSummaryFieldsSchema),
  Schema.TaggedStruct("unchanged", installSummaryFieldsSchema),
).annotations({
  description: "Applied or already-current installation result.",
});

export type InstallSummary = Schema.Schema.Type<typeof installSummarySchema>;

export class InstallError extends Schema.TaggedError<InstallError>()("InstallError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable decode, inspection, planning, or application failure.",
  }),
}) {
  get message(): string {
    return `Cannot install agent-setup: ${this.issue}`;
  }
}

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const toInstallError = (error: unknown): InstallError =>
  error instanceof InstallError ? error : new InstallError({ issue: errorMessage(error) });
