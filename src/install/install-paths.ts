import { z } from "zod";

import { absoluteRootSchema } from "./plan.js";

export const receiptPath = ".claude/agent-setup/receipt.json";
export const settingsPath = ".claude/settings.json";
export const hooksPath = ".claude/agent-setup/hooks";

// Generated hook commands embed the root inside double quotes, so shell-expanding characters are refused.
const isUnsafeRootCharacter = (character: string): boolean =>
  '"`$\\'.includes(character) || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127;

const installationRootSchema = absoluteRootSchema.refine((root) => !Array.from(root).some(isUnsafeRootCharacter), {
  message: "Installation roots must not contain shell-expanding or control characters.",
});

export const installationDestinationSchema = z
  .discriminatedUnion("_tag", [
    z.strictObject({
      _tag: z.literal("global"),
      root: installationRootSchema.describe("Absolute home root that receives one global installation."),
    }),
    z.strictObject({
      _tag: z.literal("project"),
      root: installationRootSchema.describe("Absolute project root that receives one project installation."),
    }),
  ])
  .describe("Exactly one installation scope and its corresponding filesystem root.");

export type InstallationDestination = z.infer<typeof installationDestinationSchema>;

const installationHostSchema = z
  .strictObject({
    homeRoot: installationRootSchema.describe(
      "Canonicalizable home root used only for the global installation/config scope.",
    ),
  })
  .describe("Host path evidence captured by the CLI edge before the install runs.");

export const installationLocationSchema = z
  .strictObject({
    destination: installationDestinationSchema,
    host: installationHostSchema,
  })
  .refine(
    (location) => {
      const isGlobalDestinationOffHome =
        location.destination._tag === "global" && location.destination.root !== location.host.homeRoot;

      return !isGlobalDestinationOffHome;
    },
    {
      path: ["host", "homeRoot"],
      message: "A global installation destination must equal the captured home root.",
    },
  );
