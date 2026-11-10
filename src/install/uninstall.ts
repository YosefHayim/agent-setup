import { FileSystem, Path } from "@effect/platform";
import { Effect, ParseResult, Schema } from "effect";
import { zodAsEffectSchema } from "../zod-as-effect-schema.js";
import { applyPlan } from "./apply-plan.js";
import { hashBytes } from "./file-bytes.js";
import { installationLocationSchema, receiptPath } from "./install-paths.js";
import { errorMessage, InstallError, interactionSchema, toInstallError } from "./install-request.js";
import { planUninstall } from "./plan-changes.js";
import { readReceipt, scopeSchema } from "./receipt.js";
import { planRestorations } from "./restore.js";

export const uninstallRequestSchema = Schema.extend(
  installationLocationSchema,
  Schema.Struct({
    interaction: interactionSchema,
  }),
).annotations({
  description: "Complete uninstall capability request without agent detection or prepared-package evidence.",
});

type UninstallRequest = Schema.Schema.Type<typeof uninstallRequestSchema>;

const uninstallSummaryFieldsSchema = {
  scope: zodAsEffectSchema(scopeSchema),
  interaction: interactionSchema,
};

const uninstallSummarySchema = Schema.Union(
  Schema.TaggedStruct("uninstalled", uninstallSummaryFieldsSchema),
  Schema.TaggedStruct("absent", uninstallSummaryFieldsSchema),
);

type UninstallSummary = Schema.Schema.Type<typeof uninstallSummarySchema>;

class UninstallError extends Schema.TaggedError<UninstallError>()("UninstallError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable uninstall decode, receipt, restoration, planning, or application failure.",
  }),
}) {
  get message(): string {
    return `Cannot uninstall agent-setup: ${this.issue}`;
  }
}

const toUninstallError = (error: unknown): UninstallError => {
  if (error instanceof UninstallError) {
    return error;
  }

  return new UninstallError({ issue: error instanceof InstallError ? error.issue : errorMessage(error) });
};

const decodeUninstallRequest = (input: unknown) =>
  Schema.decodeUnknown(uninstallRequestSchema, { onExcessProperty: "error" })(input).pipe(
    Effect.mapError((error) => new UninstallError({ issue: ParseResult.TreeFormatter.formatErrorSync(error) })),
  );

const uninstallSummary = (tag: UninstallSummary["_tag"], request: UninstallRequest): UninstallSummary => ({
  _tag: tag,
  scope: request.destination._tag,
  interaction: request.interaction,
});

export const uninstall = (input: unknown) =>
  Effect.gen(function* () {
    const decoded = yield* decodeUninstallRequest(input);
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const request = yield* decodeUninstallRequest({
      ...decoded,
      destination: { ...decoded.destination, root: yield* fileSystem.realPath(decoded.destination.root) },
      host: { homeRoot: yield* fileSystem.realPath(decoded.host.homeRoot) },
    });

    // The receipt is the only authority to remove anything, so no receipt means nothing to do.
    const receiptSnapshot = yield* Effect.tryPromise({
      try: () => readReceipt(path.join(request.destination.root, receiptPath)),
      catch: toInstallError,
    });
    if (receiptSnapshot._tag === "missing") {
      return uninstallSummary("absent", request);
    }
    if (receiptSnapshot.receipt.scope !== request.destination._tag) {
      return yield* new UninstallError({ issue: "Existing receipt scope does not match the requested destination." });
    }

    const restorations = yield* planRestorations({
      root: request.destination.root,
      files: receiptSnapshot.receipt.ownedFiles,
    });
    const plannedUninstall = yield* Effect.try({
      try: () =>
        planUninstall({
          root: request.destination.root,
          receipt: receiptSnapshot.receipt,
          restorations,
          receiptTarget: {
            path: receiptPath,
            kind: { _tag: "receipt" },
            owner: { _tag: "application" },
          },
          receiptExpectedCurrent: { _tag: "file", sha256: hashBytes(receiptSnapshot.bytes) },
        }),
      catch: (error) => new UninstallError({ issue: `Generated uninstall plan is invalid: ${errorMessage(error)}` }),
    });

    yield* applyPlan(plannedUninstall);

    return uninstallSummary("uninstalled", request);
  }).pipe(Effect.mapError(toUninstallError));
