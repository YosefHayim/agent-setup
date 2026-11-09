import { z } from "zod";

// Text that has content and no leading or trailing spaces, so a value is never stored padded.
export const nonEmptyTrimmedTextSchema = z
  .string()
  .min(1)
  .refine((text) => text === text.trim(), { message: "Text must not start or end with spaces." });
