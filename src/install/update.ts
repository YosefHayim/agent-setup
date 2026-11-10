import { Path } from "@effect/platform";
import { Effect, Schema, ParseResult as SchemaParseIssue } from "effect";
import { z } from "zod";
import { addDependencies } from "../catalog/feature-catalog.js";
import { zodAsEffectSchema } from "../zod-as-effect-schema.js";
import { syncInstall } from "./install.js";
import { installationLocationSchema, receiptPath } from "./install-paths.js";
import {
  agentChoiceSchema,
  configurationChoiceSchema,
  type InstallRequest,
  interactionSchema,
  platformRequirementSchema,
  preparedPackageSchema,
  readErrorMessage,
  selectedFeatureChoiceSchema,
  wrapAsInstallError,
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

class UpdateError extends Schema.TaggedError<UpdateError>()("UpdateError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable update decode, receipt, sync, or application failure.",
  }),
}) {
  get message(): string {
    return `Cannot update agent-setup: ${this.issue}`;
  }
}

const decodeStrictly =
  <Decoded, Encoded>(schema: Schema.Schema<Decoded, Encoded>) =>
  (input: unknown) =>
    Schema.decodeUnknown(schema, { onExcessProperty: "error" })(input).pipe(
      Effect.mapError((error) => new UpdateError({ issue: SchemaParseIssue.TreeFormatter.formatErrorSync(error) })),
    );

export const update = (input: unknown) =>
  Effect.gen(function* () {
    const request = yield* decodeStrictly(zodAsEffectSchema(updateRequestSchema))(input);
    const path = yield* Path.Path;
    const receiptSnapshot = yield* Effect.tryPromise({
      try: () => readReceipt(path.join(request.destination.root, receiptPath)),
      catch: wrapAsInstallError,
    });
    if (receiptSnapshot._tag === "missing") {
      return yield* new UpdateError({ issue: "No ownership receipt exists at the requested scope." });
    }

    const installedIds = receiptSnapshot.receipt.features;
    // A dependency the receipt does not list yet is added by this update, so it counts as installed here.
    const dependencyCheck = addDependencies(installedIds);
    const isInstalledFeatureUnknown = dependencyCheck.status === "unknown";
    if (isInstalledFeatureUnknown) {
      throw new Error(`Unknown feature ${dependencyCheck.featureId}.`);
    }

    const featureIdsWithDependencies = dependencyCheck.featureIds;
    const requestedFeatures = request.features;
    const isRefreshRequest = requestedFeatures._tag === "refresh";
    const missingId = isRefreshRequest
      ? (requestedFeatures.ids.find((id) => !featureIdsWithDependencies.some((featureId) => featureId === id)) ?? null)
      : null;
    const isFeatureMissing = missingId !== null;
    if (isFeatureMissing) {
      return yield* new UpdateError({
        issue: `Feature ${missingId} is not installed in this scope; use install to add it.`,
      });
    }

    // Preserved and refreshed selections reuse the receipt's features; agents always come from the request.
    const featureIds = request.features._tag === "selected" ? request.features.ids : installedIds;
    const installRequest: InstallRequest = { ...request, features: { _tag: "selected", ids: featureIds } };
    const installSummary = yield* Effect.tryPromise({
      try: (signal) => syncInstall({ request: installRequest, receiptSnapshot }, signal),
      catch: (error) => error,
    });
    const updateSummary: UpdateSummary = {
      ...installSummary,
      _tag: installSummary._tag === "installed" ? "updated" : "unchanged",
    };

    return updateSummary;
  }).pipe(
    Effect.mapError((error) =>
      error instanceof UpdateError ? error : new UpdateError({ issue: readErrorMessage(error) }),
    ),
  );
