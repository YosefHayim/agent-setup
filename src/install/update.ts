import * as path from "node:path";

import { z } from "zod";

import { addDependencies } from "../catalog/feature-catalog.js";
import { joinZodIssueMessages } from "../zod-issue-messages.js";
import { syncInstall } from "./install.js";
import { installationLocationSchema, receiptPath } from "./install-paths.js";
import {
  agentChoiceSchema,
  configurationChoiceSchema,
  type InstallRequest,
  interactionSchema,
  isInstallError,
  platformRequirementSchema,
  preparedPackageSchema,
  readErrorMessage,
  selectedFeatureChoiceSchema,
} from "./install-request.js";
import { readReceipt, scopeSchema } from "./receipt.js";

const updateFeatureChoiceSchema = z
  .discriminatedUnion("_tag", [
    z
      .strictObject({ _tag: z.literal("preserve") })
      .describe("Reuse the dependency-resolved features recorded by the current receipt."),
    z
      .strictObject({
        _tag: z.literal("refresh"),
        ids: selectedFeatureChoiceSchema.shape.ids,
      })
      .describe("Require the named features to be installed, then refresh the receipt's whole selection."),
    selectedFeatureChoiceSchema,
  ])
  .describe("Preserved, refreshed, or replacement feature selection for an existing installation.");

const updateRequestSchema = installationLocationSchema
  .extend({
    preparedPackage: preparedPackageSchema,
    features: updateFeatureChoiceSchema,
    agents: agentChoiceSchema,
    interaction: interactionSchema,
    configuration: configurationChoiceSchema,
  })
  .describe("Complete update capability request decoded before receipt inspection.");

type UpdateRequest = z.infer<typeof updateRequestSchema>;

const updateSummaryFieldsSchema = {
  scope: scopeSchema,
  features: selectedFeatureChoiceSchema.shape.ids,
  agents: agentChoiceSchema.options[0].shape.ids,
  platformRequirements: z.array(platformRequirementSchema),
  interaction: interactionSchema,
};

const updateSummarySchema = z.discriminatedUnion("_tag", [
  z.strictObject({ _tag: z.literal("updated"), ...updateSummaryFieldsSchema }),
  z.strictObject({ _tag: z.literal("unchanged"), ...updateSummaryFieldsSchema }),
]);

type UpdateSummary = z.infer<typeof updateSummarySchema>;

const UPDATE_ERROR_NAME = "UpdateError";

// Update failures are plain Errors named UpdateError, the same way install and uninstall failures are named.
const createUpdateError = (issue: string, cause?: unknown): Error =>
  Object.assign(new Error(`Cannot update agent-setup: ${issue}`, { cause }), { name: UPDATE_ERROR_NAME });

const isUpdateError = (error: unknown): error is Error => error instanceof Error && error.name === UPDATE_ERROR_NAME;

const wrapAsUpdateError = (error: unknown): Error => {
  const isAlreadyUpdateError = isUpdateError(error);
  if (isAlreadyUpdateError) {
    return error;
  }

  const isInstallFailure = isInstallError(error);
  if (isInstallFailure) {
    return createUpdateError(error.issue, error);
  }

  return createUpdateError(readErrorMessage(error), error);
};

const parseUpdateRequest = (input: unknown): UpdateRequest => {
  const requestCheck = updateRequestSchema.safeParse(input);
  const isRequestInvalid = !requestCheck.success;
  if (isRequestInvalid) {
    throw createUpdateError(joinZodIssueMessages(requestCheck.error));
  }

  return requestCheck.data;
};

const applyUpdate = async (input: unknown, signal: AbortSignal): Promise<UpdateSummary> => {
  const request = parseUpdateRequest(input);
  const receiptSnapshot = await readReceipt(path.join(request.destination.root, receiptPath));
  const isReceiptMissing = receiptSnapshot._tag === "missing";
  if (isReceiptMissing) {
    throw createUpdateError("No ownership receipt exists at the requested scope.");
  }

  const installedIds = receiptSnapshot.receipt.features;
  // A dependency the receipt does not list yet is added by this update, so it counts as installed here.
  const dependencyCheck = addDependencies(installedIds);
  const isInstalledFeatureUnknown = dependencyCheck.status === "unknown";
  if (isInstalledFeatureUnknown) {
    throw createUpdateError(`Unknown feature ${dependencyCheck.featureId}.`);
  }

  const featureIdsWithDependencies = dependencyCheck.featureIds;
  const requestedFeatures = request.features;
  const isRefreshRequest = requestedFeatures._tag === "refresh";
  const refreshedIds = isRefreshRequest ? requestedFeatures.ids : [];
  const missingId = refreshedIds.find((id) => !featureIdsWithDependencies.includes(id)) ?? null;
  const isFeatureMissing = missingId !== null;
  if (isFeatureMissing) {
    throw createUpdateError(`Feature ${missingId} is not installed in this scope; use install to add it.`);
  }

  // Preserved and refreshed selections reuse the receipt's features; agents always come from the request.
  const isSelectedFeatures = requestedFeatures._tag === "selected";
  const featureIds = isSelectedFeatures ? requestedFeatures.ids : installedIds;
  const installRequest: InstallRequest = { ...request, features: { _tag: "selected", ids: featureIds } };
  const installSummary = await syncInstall({ request: installRequest, receiptSnapshot }, signal);

  const updateSummary: UpdateSummary = {
    ...installSummary,
    _tag: installSummary._tag === "installed" ? "updated" : "unchanged",
  };

  return updateSummary;
};

export const update = async (input: unknown, signal: AbortSignal): Promise<UpdateSummary> => {
  try {
    return await applyUpdate(input, signal);
  } catch (error) {
    throw wrapAsUpdateError(error);
  }
};
