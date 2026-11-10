import { ZodError, z } from "zod";

import { agentEvidenceSchema, agentIdSchema } from "../catalog/agent-catalog.js";
import { featureIdSchema, featurePlatformSchema } from "../catalog/feature-catalog.js";
import { type Config, isConfig } from "../config/config-schema.js";
import { joinZodIssueMessages } from "../zod-issue-messages.js";
import { installationLocationSchema } from "./install-paths.js";
import { absoluteRootSchema } from "./plan.js";
import { scopeSchema, versionSchema } from "./receipt.js";

const INSTALL_ERROR_NAME = "InstallError";

export const selectedFeatureChoiceSchema = z.strictObject({
  _tag: z.literal("selected"),
  ids: z.array(featureIdSchema).describe("Explicit public feature IDs expanded through catalog dependencies."),
});

const featureChoiceSchema = z
  .discriminatedUnion("_tag", [
    z.strictObject({ _tag: z.literal("defaults") }).describe("Catalog features selected by default."),
    selectedFeatureChoiceSchema,
  ])
  .describe("Default or explicit feature selection without behavior flags.");

const selectedAgentChoiceSchema = z.strictObject({
  _tag: z.literal("selected"),
  ids: z.array(agentIdSchema).describe("Explicit public agent IDs receiving native files."),
});

export const agentChoiceSchema = z
  .discriminatedUnion("_tag", [
    selectedAgentChoiceSchema,
    z.strictObject({
      _tag: z.literal("detected"),
      evidence: agentEvidenceSchema.describe(
        "Observed evidence the decoded agent catalog uses to detect installed agents.",
      ),
    }),
  ])
  .describe("Explicit or evidence-derived agent selection.");

export const interactionSchema = z
  .discriminatedUnion("_tag", [
    z.strictObject({ _tag: z.literal("interactive") }),
    z.strictObject({ _tag: z.literal("scripted") }),
  ])
  .describe("Caller interaction mode retained for presentation at the CLI edge.");

export const configurationChoiceSchema = z
  .discriminatedUnion("_tag", [
    z
      .strictObject({ _tag: z.literal("automatic") })
      .describe("Reuse this scope's config, inherit once for a project, or use schema defaults."),
    z.strictObject({
      _tag: z.literal("selected"),
      config: z
        .custom<Config>(isConfig)
        .describe("Complete validated configuration explicitly selected by the caller."),
    }),
    z
      .strictObject({ _tag: z.literal("reset") })
      .describe("Replace the managed config with schema defaults whatever the current file holds."),
  ])
  .describe("Automatic, explicit, or reset complete configuration selection.");

export const preparedPackageSchema = z
  .strictObject({
    root: absoluteRootSchema.describe("Absolute prepared dist root containing only verified skills and runtime files."),
    version: versionSchema.describe("Semantic package version published in the ownership receipt."),
  })
  .describe("Verified prepared package consumed by installation.");

export const installRequestSchema = installationLocationSchema
  .extend({
    preparedPackage: preparedPackageSchema,
    features: featureChoiceSchema,
    agents: agentChoiceSchema,
    interaction: interactionSchema,
    configuration: configurationChoiceSchema,
  })
  .describe("Complete install capability request decoded before filesystem inspection.");

export type InstallRequest = z.infer<typeof installRequestSchema>;

export const platformRequirementSchema = z
  .strictObject({
    featureId: featureIdSchema.describe("Selected feature that declared this host requirement."),
    platform: featurePlatformSchema,
  })
  .describe("Catalog-correlated host requirement surfaced without hidden environment probing.");

const installSummaryFieldsSchema = {
  scope: scopeSchema.describe("Scope synced by this capability call."),
  features: z.array(featureIdSchema).describe("Dependency-resolved features in catalog order."),
  agents: z.array(agentIdSchema).describe("Selected agents in catalog order."),
  platformRequirements: z
    .array(platformRequirementSchema)
    .describe("Platform requirement for every dependency-resolved selected feature."),
  interaction: interactionSchema,
};

const installSummarySchema = z
  .discriminatedUnion("_tag", [
    z.strictObject({ _tag: z.literal("installed"), ...installSummaryFieldsSchema }),
    z.strictObject({ _tag: z.literal("unchanged"), ...installSummaryFieldsSchema }),
  ])
  .describe("Applied or already-current installation result.");

export type InstallSummary = z.infer<typeof installSummarySchema>;

export const readErrorMessage = (error: unknown): string => {
  const isErrorObject = error instanceof Error;
  if (isErrorObject) {
    return error.message;
  }

  return String(error);
};

// Install failures are plain Errors named InstallError, so the CLI and the tests find them by that name.
export const createInstallError = (issue: string): Error =>
  Object.assign(new Error(`Cannot install agent-setup: ${issue}`), { name: INSTALL_ERROR_NAME, issue });

export const isInstallError = (error: unknown): error is Error & { readonly issue: string } =>
  error instanceof Error && error.name === INSTALL_ERROR_NAME;

export const wrapAsInstallError = (error: unknown): Error => {
  if (isInstallError(error)) {
    return error;
  }

  const isZodRejection = error instanceof ZodError;
  if (isZodRejection) {
    return createInstallError(joinZodIssueMessages(error));
  }

  return createInstallError(readErrorMessage(error));
};
