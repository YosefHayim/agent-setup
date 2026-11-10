import { Schema } from "effect";
import type { z } from "zod";

// Lets a schema still written with Effect's Schema use a zod schema's check, until the Effect schema itself moves to zod.
export const zodAsEffectSchema = <Output>(zodSchema: z.ZodType<Output>) =>
  Schema.declare((input: unknown): input is Output => zodSchema.safeParse(input).success);
