/** Where one installation lives: the receipt, hook, and state folders under a scope root, and the checked root itself. */

import { Schema } from "effect";

import { zodAsEffectSchema } from "../zod-as-effect-schema.js";
import { absoluteRootSchema } from "./plan.js";

export const receiptPath = ".claude/agent-setup/receipt.json";
export const settingsPath = ".claude/settings.json";
export const hooksPath = ".claude/agent-setup/hooks";

// Generated hook commands embed the root inside double quotes, so shell-expanding characters are refused.
const isUnsafeRootCharacter = (character: string): boolean =>
  '"`$\\'.includes(character) || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127;

const installationRootSchema = zodAsEffectSchema(absoluteRootSchema).pipe(
  Schema.filter((root) => !Array.from(root).some(isUnsafeRootCharacter), {
    message: () => "Installation roots must not contain shell-expanding or control characters.",
  }),
);

export const installationDestinationSchema = Schema.Union(
  Schema.TaggedStruct("global", {
    root: installationRootSchema.annotations({
      description: "Absolute home root that receives one global installation.",
    }),
  }),
  Schema.TaggedStruct("project", {
    root: installationRootSchema.annotations({
      description: "Absolute project root that receives one project installation.",
    }),
  }),
).annotations({
  description: "Exactly one installation scope and its corresponding filesystem root.",
});

const installationHostSchema = Schema.Struct({
  homeRoot: installationRootSchema.annotations({
    description: "Canonicalizable home root used only for the global installation/config scope.",
  }),
}).annotations({
  description: "Host path evidence captured by the CLI edge before the install runs.",
});

export const installationLocationSchema = Schema.Struct({
  destination: installationDestinationSchema,
  host: installationHostSchema,
}).pipe(
  Schema.filter((location) =>
    location.destination._tag === "global" && location.destination.root !== location.host.homeRoot
      ? {
          path: ["host", "homeRoot"],
          message: "A global installation destination must equal the captured home root.",
        }
      : undefined,
  ),
);
