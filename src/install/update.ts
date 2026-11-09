import { Path } from "@effect/platform";
import { Effect, Schema, ParseResult as SchemaParseIssue } from "effect";
import { addDependencies } from "../catalog/feature-catalog.js";
import { syncInstall } from "./install.js";
import { installationLocationSchema, receiptPath } from "./install-paths.js";
import {
  agentChoiceSchema,
  configurationChoiceSchema,
  errorMessage,
  type InstallRequest,
  interactionSchema,
  platformRequirementSchema,
  preparedPackageSchema,
  selectedFeatureChoiceSchema,
} from "./install-request.js";
import { readReceipt } from "./receipt.js";

const updateFeatureChoiceSchema = Schema.Union(
  Schema.TaggedStruct("preserve", {}).annotations({
    description: "Reuse the dependency-resolved features recorded by the current receipt.",
  }),
  Schema.TaggedStruct("refresh", { ids: selectedFeatureChoiceSchema.fields.ids }).annotations({
    description: "Require the named features to be installed, then refresh the receipt's whole selection.",
  }),
  selectedFeatureChoiceSchema,
).annotations({
  description: "Preserved, refreshed, or replacement feature selection for an existing installation.",
});

const updateRequestSchema = Schema.extend(
  installationLocationSchema,
  Schema.Struct({
    preparedPackage: preparedPackageSchema,
    features: updateFeatureChoiceSchema,
    agents: agentChoiceSchema,
    interaction: interactionSchema,
    configuration: configurationChoiceSchema,
  }),
).annotations({
  description: "Complete update capability request decoded before receipt inspection.",
});

const updateSummaryFieldsSchema = {
  scope: Schema.Literal("global", "project"),
  features: selectedFeatureChoiceSchema.fields.ids,
  agents: agentChoiceSchema.members[0].fields.ids,
  platformRequirements: Schema.Array(platformRequirementSchema),
  interaction: interactionSchema,
};

const updateSummarySchema = Schema.Union(
  Schema.TaggedStruct("updated", updateSummaryFieldsSchema),
  Schema.TaggedStruct("unchanged", updateSummaryFieldsSchema),
);

type UpdateSummary = Schema.Schema.Type<typeof updateSummarySchema>;

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
    const request = yield* decodeStrictly(updateRequestSchema)(input);
    const path = yield* Path.Path;
    const receiptSnapshot = yield* readReceipt(path.join(request.destination.root, receiptPath));
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
    const isRefreshRequest = request.features._tag === "refresh";
    const missingId = isRefreshRequest
      ? (request.features.ids.find((id) => !featureIdsWithDependencies.includes(id)) ?? null)
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
    const installSummary = yield* syncInstall({ request: installRequest, receiptSnapshot });
    const updateSummary: UpdateSummary = {
      ...installSummary,
      _tag: installSummary._tag === "installed" ? "updated" : "unchanged",
    };

    return updateSummary;
  }).pipe(
    Effect.mapError((error) =>
      error instanceof UpdateError ? error : new UpdateError({ issue: errorMessage(error) }),
    ),
  );
