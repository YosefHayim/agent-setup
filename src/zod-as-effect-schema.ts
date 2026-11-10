import { Schema } from "effect";
import type { z } from "zod";

import { joinZodIssueMessages } from "./zod-issue-messages.js";

const describeZodRejection = <Output>(zodSchema: z.ZodType<Output>, rejectedInput: unknown): string => {
  const zodCheck = zodSchema.safeParse(rejectedInput);
  const isInputAccepted = zodCheck.success;
  if (isInputAccepted) {
    return "Value does not match its schema.";
  }

  return joinZodIssueMessages(zodCheck.error);
};

// Lets a schema still written with Effect's Schema use a zod schema's check and its messages, until the Effect schema itself moves to zod.
export const zodAsEffectSchema = <Output>(zodSchema: z.ZodType<Output>) =>
  Schema.declare((input: unknown): input is Output => zodSchema.safeParse(input).success, {
    message: (issue) => describeZodRejection(zodSchema, issue.actual),
  });
