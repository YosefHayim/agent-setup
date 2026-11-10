import { realpath } from "node:fs/promises";
import * as path from "node:path";

import type { z } from "zod";

import { joinZodIssueMessages } from "#src/zod-issue-messages.js";
import { applyPlan } from "./apply-plan.js";
import { hashBytes } from "./file-bytes.js";
import { installationLocationSchema, receiptPath } from "./install-paths.js";
import { interactionSchema, isInstallError, readErrorMessage } from "./install-request.js";
import type { FileChange, Plan } from "./plan.js";
import { planUninstall } from "./plan-changes.js";
import { type Receipt, readReceipt, type Scope } from "./receipt.js";
import { planRestorations } from "./restore.js";

export const uninstallRequestSchema = installationLocationSchema
  .extend({
    interaction: interactionSchema,
  })
  .describe("Complete uninstall capability request without agent detection or prepared-package evidence.");

type UninstallRequest = z.infer<typeof uninstallRequestSchema>;

interface UninstallSummary {
  readonly _tag: "uninstalled" | "absent";
  readonly scope: Scope;
  readonly interaction: UninstallRequest["interaction"];
}

const UNINSTALL_ERROR_NAME = "UninstallError";

// Uninstall failures are plain Errors named UninstallError, the same way install failures are named InstallError.
const createUninstallError = (issue: string, cause?: unknown): Error =>
  Object.assign(new Error(`Cannot uninstall agent-setup: ${issue}`, { cause }), { name: UNINSTALL_ERROR_NAME });

const isUninstallError = (error: unknown): error is Error =>
  error instanceof Error && error.name === UNINSTALL_ERROR_NAME;

const wrapAsUninstallError = (error: unknown): Error => {
  const isAlreadyUninstallError = isUninstallError(error);
  if (isAlreadyUninstallError) {
    return error;
  }

  const isInstallFailure = isInstallError(error);
  if (isInstallFailure) {
    return createUninstallError(error.issue, error);
  }

  return createUninstallError(readErrorMessage(error), error);
};

const parseUninstallRequest = (uncheckedRequest: unknown): UninstallRequest => {
  const requestCheck = uninstallRequestSchema.safeParse(uncheckedRequest);

  const isRequestInvalid = !requestCheck.success;
  if (isRequestInvalid) {
    throw createUninstallError(joinZodIssueMessages(requestCheck.error));
  }

  return requestCheck.data;
};

const readUninstallSummary = (tag: UninstallSummary["_tag"], request: UninstallRequest): UninstallSummary => ({
  _tag: tag,
  scope: request.destination._tag,
  interaction: request.interaction,
});

// A generated plan that fails its own checks is an uninstall failure, not an internal error.
const planCheckedUninstall = (checkedUninstall: {
  root: string;
  receipt: Receipt;
  receiptBytes: Uint8Array;
  restorations: ReadonlyArray<FileChange>;
}): Plan => {
  try {
    return planUninstall({
      root: checkedUninstall.root,
      receipt: checkedUninstall.receipt,
      restorations: checkedUninstall.restorations,
      receiptTarget: {
        path: receiptPath,
        kind: { _tag: "receipt" },
        owner: { _tag: "application" },
      },
      receiptExpectedCurrent: { _tag: "file", sha256: hashBytes(checkedUninstall.receiptBytes) },
    });
  } catch (error) {
    throw createUninstallError(`Generated uninstall plan is invalid: ${readErrorMessage(error)}`, error);
  }
};

export const uninstall = async (uncheckedRequest: unknown, signal: AbortSignal): Promise<UninstallSummary> => {
  try {
    const decoded = parseUninstallRequest(uncheckedRequest);
    const destinationRoot = await realpath(decoded.destination.root);
    const homeRoot = await realpath(decoded.host.homeRoot);
    const request = parseUninstallRequest({
      ...decoded,
      destination: { ...decoded.destination, root: destinationRoot },
      host: { homeRoot },
    });

    // The receipt is the only authority to remove anything, so no receipt means nothing to do.
    const receiptSnapshot = await readReceipt(path.join(request.destination.root, receiptPath));

    const isReceiptMissing = receiptSnapshot._tag === "missing";
    if (isReceiptMissing) {
      return readUninstallSummary("absent", request);
    }

    const isScopeMismatched = receiptSnapshot.receipt.scope !== request.destination._tag;
    if (isScopeMismatched) {
      throw createUninstallError("Existing receipt scope does not match the requested destination.");
    }

    const restorations = await planRestorations({
      root: request.destination.root,
      files: receiptSnapshot.receipt.ownedFiles,
    });
    const plannedUninstall = planCheckedUninstall({
      root: request.destination.root,
      receipt: receiptSnapshot.receipt,
      receiptBytes: receiptSnapshot.bytes,
      restorations,
    });
    await applyPlan(plannedUninstall, signal);

    return readUninstallSummary("uninstalled", request);
  } catch (error) {
    throw wrapAsUninstallError(error);
  }
};
